import { Pcm16Resampler, SentenceSplitter, TTS } from '@micdrop/server'
import OpenAI from 'openai'
import { Readable } from 'stream'
import { OpenaiOptions } from './OpenaiAgent'
import { OpenaiRealtimeSpeech, Synthesis } from './OpenaiRealtimeSpeech'

/**
 * OpenAI Text-to-Speech
 *
 * @see https://platform.openai.com/docs/guides/text-to-speech
 * @see https://developers.openai.com/api/docs/deprecations
 *
 * Two ways to synthesize, picked by the model:
 * - tts-1, tts-1-hd and gpt-4o-mini-tts go through the speech endpoint, which
 *   OpenAI shuts down on January 6, 2027.
 * - gpt-realtime-* models go through the Realtime API, see
 *   OpenaiRealtimeSpeech. gpt-realtime-2.1-mini is the replacement OpenAI
 *   names for the speech endpoint.
 *
 * Neither takes a text stream in, so the incoming text is buffered into
 * sentences and each sentence is synthesized as soon as it is complete. The
 * audio is emitted in the order the sentences were written, while playback
 * still starts as soon as the first sentence is ready.
 */

export type OpenaiTTSOptions = OpenaiOptions & {
  // A speech endpoint model (default) or a gpt-realtime-* model
  model?: string
  // The Realtime API has no fable, nova and onyx voices, and adds marin and
  // cedar, its default
  voice?: string
  // Delivery instructions (accent, emotion, speed, tone...).
  // Works with gpt-4o-mini-tts and gpt-realtime-* models, not tts-1 / tts-1-hd.
  instructions?: string
  // Speech speed from 0.25 to 4.0 with tts-1 / tts-1-hd, from 0.25 to 1.5
  // with gpt-realtime-* models. Ignored by gpt-4o-mini-tts.
  speed?: number
  // Reasoning of gpt-realtime-* models before speaking, 'minimal' by default
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  // Timeout to open the Realtime connection, in milliseconds
  connectionTimeout?: number
}

const DEFAULT_MODEL = 'gpt-4o-mini-tts'
const DEFAULT_VOICE = 'alloy'
const DEFAULT_REALTIME_VOICE = 'marin'
const OPENAI_SAMPLE_RATE = 24000 // Rate of the pcm output from OpenAI
const OUTPUT_SAMPLE_RATE = 16000 // Rate expected by the Micdrop client
const MAX_IN_FLIGHT = 2 // Requests asked for at once, current one included
// Audio held back at the start of an utterance, in bytes of the output format
// (16 bits, 16 kHz, so 32 bytes per millisecond).
//
// The speech endpoint answers with a burst of a hundred milliseconds or so,
// then goes quiet while it generates the rest. Forwarding that burst as it
// arrives means the browser starts playing a syllable it cannot continue, and
// the hole lands inside the first word. Holding the opening back until there
// is enough of it to cover the pause costs the same time either way, and
// spends it before the first syllable rather than inside it.
const OPENING_CUSHION = 300 * 32

interface QueueItem {
  counter: number
  text: string
}

/** A sentence whose synthesis has been asked for and not yet spoken. */
interface PendingItem extends QueueItem {
  synthesis: Synthesis
}

export class OpenaiTTS extends TTS {
  private openai?: OpenAI
  private realtime?: OpenaiRealtimeSpeech
  private counter = 0 // Identifies the current speak() call
  // Bumped by every speak() and every cancel(), so a call claimed late can tell
  // whether it is still the one that should be heard. Kept apart from
  // `counter`, which numbers the synthesis calls and must only move when there
  // is something to synthesize.
  private generation = 0
  private splitter = new SentenceSplitter()
  private queue: QueueItem[] = [] // Sentences whose synthesis has not started
  private pending: PendingItem[] = [] // Requests in flight, in speaking order
  private cushion: Buffer[] = [] // Opening audio held back, see OPENING_CUSHION
  private cushionBytes = 0
  private processing = false
  // More than one request is in flight at a time, so they are stopped as a set.
  private syntheses = new Set<Synthesis>()

  constructor(private readonly options: OpenaiTTSOptions) {
    super()
    const model = options.model || DEFAULT_MODEL
    if (model.startsWith('gpt-realtime')) {
      this.realtime = new OpenaiRealtimeSpeech(
        {
          apiKey:
            ('openai' in options ? options.openai.apiKey : options.apiKey) ?? '',
          model,
          voice: options.voice || DEFAULT_REALTIME_VOICE,
          instructions: options.instructions,
          speed: options.speed,
          reasoningEffort: options.reasoningEffort,
          connectionTimeout: options.connectionTimeout,
        },
        (...message) => this.log(...message)
      )
    } else {
      this.openai =
        'openai' in options
          ? options.openai
          : new OpenAI({ apiKey: options.apiKey })
    }
  }

  speak(textStream: Readable) {
    const generation = ++this.generation
    let counter = 0

    // Claiming the call is deferred until there is something to say.
    //
    // Taking the next number right away would drop the utterance still being
    // spoken, since both the queue and the streaming reader skip anything
    // stamped with an older one. A stream that never carries a word, which is
    // what an answer skipped by a tool or by onBeforeAnswer hands over, would
    // then cut the assistant off and throw away the sentences still queued.
    const claimCall = () => {
      if (counter) return true
      // Cancelled, or superseded by another speak(), before the first word.
      if (this.generation !== generation) return false
      this.counter++
      counter = this.counter
      this.splitter.reset()
      this.cushion = []
      this.cushionBytes = 0
      return true
    }

    textStream.on('data', (chunk: Buffer) => {
      if (!claimCall()) return
      if (counter !== this.counter) return
      for (const sentence of this.splitter.push(chunk.toString('utf-8'))) {
        this.enqueue(counter, sentence)
      }
    })

    textStream.on('error', (error) => {
      this.log('Error in text stream', error)
    })

    textStream.on('end', () => {
      // Nothing was ever said, so there is nothing left to flush.
      if (!counter || counter !== this.counter) return
      for (const sentence of this.splitter.flush()) {
        this.enqueue(counter, sentence)
      }
    })
  }

  cancel() {
    this.generation++
    this.log('Cancel')
    // Increment counter to ignore in-flight and queued work
    this.counter++
    this.splitter.reset()
    this.queue = []
    this.pending = []
    this.cushion = []
    this.cushionBytes = 0
    this.syntheses.forEach((synthesis) => synthesis.cancel())
    this.syntheses.clear()
  }

  destroy() {
    super.destroy()
    this.realtime?.destroy()
  }

  private enqueue(counter: number, text: string) {
    this.queue.push({ counter, text })
    this.pump()
  }

  /**
   * Starts what can be started, then speaks what is ready.
   *
   * A request takes a few hundred milliseconds before its first byte, and
   * waiting for that between two sentences leaves a silence in the middle of
   * her voice. It is loudest at the very start, where a greeting is often one
   * short sentence: a syllable, a hole, then the rest of the answer. Asking for
   * a sentence the moment it is complete, rather than when its turn to be
   * spoken comes, hides that latency behind the audio already playing.
   *
   * Two requests at a time is enough to cover the gap, and it keeps a long
   * answer from opening one request per sentence all at once.
   */
  private pump() {
    while (this.pending.length < MAX_IN_FLIGHT && this.queue.length > 0) {
      const item = this.queue.shift()!
      // Skip work from a cancelled or superseded speak() call
      if (item.counter !== this.counter) continue
      const synthesis = this.realtime
        ? this.realtime.synthesize(item.text)
        : this.requestSpeech(item.text)
      this.syntheses.add(synthesis)
      this.pending.push({ ...item, synthesis })
    }
    this.drain()
  }

  /** Speaks the started requests in the order they were queued. */
  private async drain() {
    if (this.processing) return
    this.processing = true

    while (this.pending.length > 0) {
      const item = this.pending.shift()!
      // A slot just freed, so the sentence after the next one can start now
      this.pump()
      await this.speakItem(item)
    }

    this.processing = false
    // Nothing left to speak: an utterance shorter than the cushion is released
    // here, since there is no longer anything coming to fill it up.
    this.flushCushion()
    // Sentences may have arrived right as we exited the loop
    if (this.pending.length > 0 || this.queue.length > 0) this.pump()
  }

  /**
   * Asks the speech endpoint for one sentence, without waiting for the answer.
   *
   * Only for tts-1, tts-1-hd and gpt-4o-mini-tts, until January 6, 2027.
   */
  private requestSpeech(text: string): Synthesis {
    const controller = new AbortController()
    const response = this.openai!.audio.speech.create(
      {
        model: this.options.model || DEFAULT_MODEL,
        voice: this.options.voice || DEFAULT_VOICE,
        input: text,
        response_format: 'pcm',
        ...(this.options.instructions
          ? { instructions: this.options.instructions }
          : {}),
        ...(this.options.speed ? { speed: this.options.speed } : {}),
      },
      { signal: controller.signal }
    )
    // Rejected before its turn comes, which nothing awaits yet
    response.catch(() => {})

    async function* read() {
      const { body } = await response
      if (!body) return
      const resampler = new Pcm16Resampler(
        OPENAI_SAMPLE_RATE,
        OUTPUT_SAMPLE_RATE
      )
      const reader = body.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const output = resampler.process(Buffer.from(value))
          if (output.length > 0) yield output
        }
      } finally {
        reader.cancel().catch(() => {})
      }
    }

    return { audio: read(), cancel: () => controller.abort() }
  }

  /** Holds the opening of an utterance back, then lets the rest through. */
  private emitAudio(chunk: Buffer) {
    if (this.cushionBytes >= OPENING_CUSHION) {
      this.emit('Audio', chunk)
      return
    }
    this.cushion.push(chunk)
    this.cushionBytes += chunk.length
    if (this.cushionBytes >= OPENING_CUSHION) this.flushCushion()
  }

  private flushCushion() {
    if (this.cushion.length === 0) return
    const held = this.cushion
    this.cushion = []
    for (const chunk of held) this.emit('Audio', chunk)
  }

  /** Emits one sentence as its audio arrives, from a request started earlier. */
  private async speakItem(item: PendingItem) {
    try {
      if (item.counter !== this.counter) return
      this.log(`Synthesizing: "${item.text}"`)
      for await (const chunk of item.synthesis.audio) {
        if (item.counter !== this.counter) break
        this.emitAudio(chunk)
      }
    } catch (error) {
      // A cancel stops the audio being read, which is expected. Anything else
      // is logged rather than left unhandled, where it would stop the server.
      if (item.counter === this.counter) {
        this.log('Error synthesizing speech:', error)
        this.emit('Failed', [item.text])
      }
    } finally {
      item.synthesis.cancel()
      this.syntheses.delete(item.synthesis)
    }
  }
}

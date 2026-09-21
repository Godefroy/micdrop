import { Pcm16Resampler, SentenceSplitter, TTS } from '@micdrop/server'
import OpenAI from 'openai'
import { Readable } from 'stream'
import { OpenaiOptions } from './OpenaiAgent'

/**
 * OpenAI Text-to-Speech
 *
 * @see https://platform.openai.com/docs/guides/text-to-speech
 *
 * The OpenAI speech endpoint takes a complete text input (no streaming text
 * in), so the incoming text stream is buffered into sentences and each
 * sentence is synthesized as soon as it is complete. Requests are processed
 * sequentially, which keeps the emitted audio in order while still starting
 * playback as soon as the first sentence is ready.
 */

export type OpenaiTTSOptions = OpenaiOptions & {
  model?: string
  voice?: string
  // Prosody instructions (accent, emotion, speed, tone...).
  // Only works with gpt-4o-mini-tts, not tts-1 / tts-1-hd.
  instructions?: string
  // Speech speed from 0.25 to 4.0. Only works with tts-1 / tts-1-hd.
  speed?: number
}

const DEFAULT_MODEL = 'gpt-4o-mini-tts'
const DEFAULT_VOICE = 'alloy'
const OPENAI_SAMPLE_RATE = 24000 // Rate of the pcm output from OpenAI
const OUTPUT_SAMPLE_RATE = 16000 // Rate expected by the Micdrop client
const MAX_IN_FLIGHT = 2 // Requests asked for at once, current one included
// Audio held back at the start of an utterance, in bytes of the output format
// (16 bits, 16 kHz, so 32 bytes per millisecond).
//
// The endpoint answers with a burst of a hundred milliseconds or so, then goes
// quiet while it generates the rest. Forwarding that burst as it arrives means
// the browser starts playing a syllable it cannot continue, and the hole lands
// inside the first word. Holding the opening back until there is enough of it
// to cover the pause costs the same time either way, and spends it before the
// first syllable rather than inside it.
const OPENING_CUSHION = 300 * 32

interface QueueItem {
  counter: number
  text: string
}

/** A sentence whose synthesis has been asked for and not yet spoken. */
interface PendingItem extends QueueItem {
  controller: AbortController
  response: Promise<{ body: ReadableStream<Uint8Array> | null } | null>
}

export class OpenaiTTS extends TTS {
  private openai: OpenAI
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
  // More than one request is in flight at a time, so they are aborted as a set.
  private abortControllers = new Set<AbortController>()

  constructor(private readonly options: OpenaiTTSOptions) {
    super()
    this.openai =
      'openai' in options
        ? options.openai
        : new OpenAI({ apiKey: options.apiKey })
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
    this.abortControllers.forEach((controller) => controller.abort())
    this.abortControllers.clear()
  }

  private enqueue(counter: number, text: string) {
    this.queue.push({ counter, text })
    this.pump()
  }

  /**
   * Starts what can be started, then speaks what is ready.
   *
   * The endpoint takes a few hundred milliseconds before its first byte, and
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
      this.pending.push(this.request(item))
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

  /** Asks for one sentence, without waiting for the answer. */
  private request(item: QueueItem): PendingItem {
    const controller = new AbortController()
    this.abortControllers.add(controller)

    const response = this.openai.audio.speech
      .create(
        {
          model: this.options.model || DEFAULT_MODEL,
          voice: this.options.voice || DEFAULT_VOICE,
          input: item.text,
          response_format: 'pcm',
          ...(this.options.instructions
            ? { instructions: this.options.instructions }
            : {}),
          ...(this.options.speed ? { speed: this.options.speed } : {}),
        },
        { signal: controller.signal }
      )
      .catch((error) => {
        if (!controller.signal.aborted) {
          this.log('Error synthesizing speech:', error)
          this.emit('Failed', [item.text])
        }
        return null
      })

    return { ...item, controller, response }
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

  /** Emits one sentence, whose request was started earlier. */
  private async speakItem(item: PendingItem) {
    try {
      const response = await item.response
      if (!response?.body) return
      if (item.counter !== this.counter) return
      this.log(`Synthesizing: "${item.text}"`)

      const resampler = new Pcm16Resampler(
        OPENAI_SAMPLE_RATE,
        OUTPUT_SAMPLE_RATE
      )
      const reader = response.body.getReader()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (item.counter !== this.counter) {
          await reader.cancel()
          break
        }
        const output = resampler.process(Buffer.from(value))
        if (output.length > 0) this.emitAudio(output)
      }
    } catch (error) {
      // A cancel aborts the body being read, which is expected. Anything else
      // is logged rather than left unhandled, where it would stop the server.
      if (!item.controller.signal.aborted) {
        this.log('Error reading synthesized speech:', error)
        this.emit('Failed', [item.text])
      }
    } finally {
      this.abortControllers.delete(item.controller)
    }
  }
}

import {
  cachedModels,
  cachedVoices,
  MicdropModel,
  MicdropVoice,
  ReconnectingSocket,
  TTS,
  voiceGender,
  voicesForLanguage,
} from '@micdrop/server'
import { Readable } from 'stream'
import { RawData } from 'ws'
import {
  CartesiaCancelPayload,
  CartesiaGenerationConfig,
  CartesiaLanguage,
  CartesiaPayload,
  CartesiaResponse,
  CartesiaSampleRate,
} from './types'

const DEFAULT_SAMPLE_RATE: CartesiaSampleRate = 48000
// Version of the API both the WebSocket and the voice listing speak
const CARTESIA_VERSION = '2025-04-16'

export interface CartesiaTTSOptions {
  apiKey: string
  modelId: string
  voiceId: string
  language?: CartesiaLanguage
  /** @deprecated Sonic 3 models read `generationConfig.speed` instead */
  speed?: 'fast' | 'normal' | 'slow'
  generationConfig?: CartesiaGenerationConfig
  /**
   * Rate of the audio, in Hz, 48000 by default, the highest one offered. It
   * goes to the client as is, so the voice is never resampled on the server.
   */
  sampleRate?: CartesiaSampleRate
  /** How long a connection attempt may take, 5000 ms by default */
  connectionTimeout?: number
  /** How long to wait before a new attempt, 1000 ms by default */
  retryDelay?: number
  /**
   * How many attempts in a row may fail before giving up and emitting
   * `Failed`, 3 by default. The next utterance tries to connect again.
   */
  maxRetry?: number
}

/**
 * The utterance Cartesia is synthesizing. While there is one the TTS is
 * speaking, and when there is none it is idle: every way out of an utterance
 * (done, server error, cancel, text stream error, give up) clears it, so
 * nothing about it outlives it.
 */
interface CartesiaContext {
  id: string
  /** Every word received so far, sent again whole on a new connection */
  text: string
  /** The text stream ended, so Cartesia was told no more text follows */
  ended: boolean
}

/** A voice as the Cartesia API lists it, the fields read here */
interface CartesiaVoice {
  id: string
  name: string
  description?: string
  language?: string
  gender?: string | null
  is_owner?: boolean
  preview_file_url?: string | null
  /** Accents the voice can take, its native one among them */
  accents?: Array<{ locale?: string; is_native?: boolean }>
}

export class CartesiaTTS extends TTS {
  /**
   * Lists the models that speak, with the languages each one reads.
   *
   * The list is fetched once and shared by every call of the process for a
   * day. `refresh` fetches it again.
   */
  static listModels(options: {
    apiKey: string
    refresh?: boolean
  }): Promise<MicdropModel[]> {
    return cachedModels(
      ['cartesia'],
      options.apiKey,
      async () => {
        const response = await fetch('https://api.cartesia.ai/models', {
          headers: {
            'X-API-Key': options.apiKey,
            'Cartesia-Version': CARTESIA_VERSION,
          },
        })
        if (!response.ok) {
          throw new Error(`Cartesia answered ${response.status}`)
        }
        const { data } = (await response.json()) as {
          data: Array<{
            id: string
            capability?: string
            supported_languages?: string[]
          }>
        }
        return data
          .filter((model) => model.capability === 'tts')
          .map((model) => ({
            id: model.id,
            languages: model.supported_languages,
          }))
      },
      options.refresh
    )
  }

  /**
   * Lists the voices the account can speak with, its own and the public ones.
   *
   * `language`, such as `fr` or `fr-FR`, keeps the voices that speak it.
   *
   * The list is fetched once and shared by every call of the process for a
   * day. `refresh` fetches it again, for a voice added a moment ago.
   */
  static listVoices(options: {
    apiKey: string
    language?: string
    refresh?: boolean
  }): Promise<MicdropVoice[]> {
    return cachedVoices(
      ['cartesia'],
      options.apiKey,
      () => fetchVoices(options.apiKey),
      options.refresh
    ).then((voices) => voicesForLanguage(voices, options.language))
  }

  private socket: ReconnectingSocket
  // Numbers the audio contexts, and only moves when there is something to say
  private counter = 0
  // Bumped by every speak() and every cancel(), so a context claimed late can
  // tell whether it is still the one that should be heard
  private generation = 0
  private context?: CartesiaContext

  get sampleRate() {
    return this.options.sampleRate ?? DEFAULT_SAMPLE_RATE
  }

  constructor(private readonly options: CartesiaTTSOptions) {
    super()

    this.socket = new ReconnectingSocket({
      url: `wss://api.cartesia.ai/tts/websocket?api_key=${this.options.apiKey}&cartesia_version=${CARTESIA_VERSION}`,
      connectionTimeout: options.connectionTimeout,
      retryDelay: options.retryDelay,
      maxRetry: options.maxRetry,
      log: (...message) => this.log(...message),
    })
    this.socket.on('Open', this.onOpen)
    this.socket.on('Message', this.onMessage)
    this.socket.on('Failed', this.onFailed)
    this.socket.connect()
  }

  speak(textStream: Readable) {
    const generation = ++this.generation
    let context: CartesiaContext | undefined

    // Claiming the context is deferred until there is something to say.
    //
    // Taking the next id right away would silence the utterance still playing,
    // because incoming audio is matched against the current context and
    // anything older is dropped. A stream that never carries a word, which is
    // what an answer skipped by a tool or by onBeforeAnswer hands over, would
    // then cut the assistant off mid-sentence for nothing.
    const claimContext = () => {
      if (context) return context
      // Cancelled, or superseded by another speak(), before the first word
      if (this.generation !== generation) return
      context = { id: (++this.counter).toString(), text: '', ended: false }
      this.context = context
      // A connection that gave up gets a new chance with a new utterance
      this.socket.connect()
      return context
    }

    textStream.on('data', (chunk: Buffer) => {
      const context = claimContext()
      if (!context || this.context !== context) return
      const text = chunk.toString('utf-8').replace(/[\r\n ]+/g, ' ')
      context.text += text
      // Without a connection the text waits, and goes out whole on open
      if (this.sendText(context.id, text, true)) {
        this.log(`Sent transcript: "${text}"`)
      }
    })

    textStream.on('error', (error) => {
      if (!context || this.context !== context) return
      this.log('Error in text stream, cancelling the audio', error)
      this.stopContext()
    })

    textStream.on('end', () => {
      // Nothing was ever said, so there is no context to close
      if (!context || this.context !== context) return
      context.ended = true
      this.sendText(context.id, '', false)
    })
  }

  cancel() {
    this.generation++
    if (!this.context) return
    this.log('Cancel')
    this.stopContext()
  }

  destroy() {
    super.destroy()
    this.socket.destroy()
    this.context = undefined
  }

  /** Asks Cartesia to drop the current context, and forgets it */
  private stopContext() {
    if (!this.context) return
    this.socket.send(
      JSON.stringify({
        context_id: this.context.id,
        cancel: true,
      } satisfies CartesiaCancelPayload)
    )
    this.context = undefined
  }

  private sendText(contextId: string, transcript: string, more: boolean) {
    return this.socket.send(
      JSON.stringify({
        ...this.getConfig(),
        transcript,
        context_id: contextId,
        continue: more,
      } satisfies CartesiaPayload)
    )
  }

  private getConfig() {
    return {
      model_id: this.options.modelId,
      voice: {
        mode: 'id',
        id: this.options.voiceId,
      },
      output_format: {
        container: 'raw',
        encoding: 'pcm_s16le',
        sample_rate: this.sampleRate,
      },
      language: this.options.language,
      speed: this.options.speed,
      generation_config: this.options.generationConfig,
    } as const
  }

  // A new connection knows nothing of the utterance under way: the text read
  // before the first connection opened, or lost with the previous one, goes out
  // again whole
  private onOpen = () => {
    const context = this.context
    if (!context) return
    if (context.text) {
      this.log('Sending text again')
      this.sendText(context.id, context.text, true)
    }
    if (context.ended) this.sendText(context.id, '', false)
  }

  private onMessage = (data: RawData) => {
    let message: CartesiaResponse
    try {
      message = JSON.parse(data.toString())
    } catch {
      this.log('Error parsing message', data)
      return
    }

    // Ignore messages from previous contexts
    if (!this.context || this.context.id !== message.context_id) return

    switch (message.type) {
      case 'chunk':
        const chunk = Buffer.from(message.data, 'base64')
        this.log(`Received audio chunk (${chunk.length} bytes)`)
        this.emit('Audio', chunk)
        break
      case 'done':
        this.log('Audio ended')
        this.context = undefined
        break
      case 'error':
        // Cartesia sends nothing more for a context it failed
        this.log('Error', message.error)
        this.context = undefined
        break
    }
  }

  private onFailed = () => {
    const text = this.context?.text
    this.context = undefined
    this.emit('Failed', text ? [text] : [])
  }
}

/** Reads every page of the voices of the account */
async function fetchVoices(apiKey: string): Promise<MicdropVoice[]> {
  const voices: MicdropVoice[] = []
  let startingAfter: string | undefined
  do {
    const params = new URLSearchParams({ limit: '100' })
    if (startingAfter) params.set('starting_after', startingAfter)
    const response = await fetch(`https://api.cartesia.ai/voices?${params}`, {
      headers: {
        'X-API-Key': apiKey,
        'Cartesia-Version': CARTESIA_VERSION,
      },
    })
    if (!response.ok) throw new Error(`Cartesia answered ${response.status}`)
    const page = (await response.json()) as {
      data: CartesiaVoice[]
      has_more?: boolean
      next_page?: string | null
    }
    for (const voice of page.data) {
      voices.push({
        id: voice.id,
        name: voice.name,
        // Its native language first, then the ones it speaks with an accent
        languages: voiceLanguages(voice),
        gender: voiceGender(voice.gender),
        description: voice.description || undefined,
        previewUrl: voice.preview_file_url || undefined,
        custom: !!voice.is_owner,
      })
    }
    startingAfter = page.has_more ? (page.next_page ?? undefined) : undefined
  } while (startingAfter)
  return voices
}

function voiceLanguages(voice: CartesiaVoice): string[] | undefined {
  const accents = (voice.accents ?? [])
    .slice()
    .sort((a, b) => Number(!!b.is_native) - Number(!!a.is_native))
    .map((accent) => accent.locale)
    .filter((locale): locale is string => !!locale)
  const languages = [...new Set([voice.language, ...accents])].filter(
    (code): code is string => !!code
  )
  return languages.length ? languages : undefined
}

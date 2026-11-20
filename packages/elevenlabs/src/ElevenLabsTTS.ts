import {
  cachedVoices,
  MicdropVoice,
  TTS,
  voiceGender,
  voicesForLanguage,
} from '@micdrop/server'
import { Readable } from 'stream'
import { DialogueWebSocket } from './DialogueWebSocket'
import { ElevenLabsWebSocket } from './ElevenLabsWebSocket'
import { SpeechWebSocket } from './SpeechWebSocket'
import {
  DEFAULT_MODEL_ID,
  ElevenLabsTTSOptions,
  getSampleRate,
  isDialogueModel,
} from './types'

/** A voice as the ElevenLabs API lists it, the fields read here */
interface ElevenLabsVoice {
  voice_id: string
  name: string
  category?: string
  description?: string | null
  preview_url?: string | null
  labels?: Record<string, string | undefined>
  verified_languages?: Array<{ language?: string; locale?: string | null }>
}

// Voices made in the account rather than offered to everyone
const CUSTOM_CATEGORIES = ['cloned', 'generated', 'professional']

/**
 * ElevenLabs text to speech, streamed over the WebSocket the model runs on.
 *
 * Eleven v3 and v4 only answer on the Text to Dialogue WebSocket, the other
 * models on the Text to Speech WebSocket. The two speak different protocols,
 * so the model picks the one this class drives.
 */
export class ElevenLabsTTS extends TTS {
  /**
   * Lists the voices the account can speak with: the premade ones, and the
   * ones cloned, designed or added from the library.
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
      ['elevenlabs'],
      options.apiKey,
      () => fetchVoices(options.apiKey),
      options.refresh
    ).then((voices) => voicesForLanguage(voices, options.language))
  }

  private readonly webSocket: ElevenLabsWebSocket
  private readonly rate: number

  constructor(options: ElevenLabsTTSOptions) {
    super()
    this.rate = getSampleRate(options)
    const host = {
      audio: (chunk: Buffer) => this.emit('Audio', chunk),
      failed: (texts: string[]) => this.emit('Failed', texts),
      log: (...message: any[]) => this.log(...message),
    }
    this.webSocket = isDialogueModel(options.modelId ?? DEFAULT_MODEL_ID)
      ? new DialogueWebSocket(options, host)
      : new SpeechWebSocket(options, host)
  }

  get sampleRate() {
    return this.rate
  }

  speak(textStream: Readable) {
    this.webSocket.speak(textStream)
  }

  cancel() {
    this.webSocket.cancel()
  }

  destroy() {
    this.webSocket.destroy()
    super.destroy()
  }
}

/** Reads every page of the voices of the account */
async function fetchVoices(apiKey: string): Promise<MicdropVoice[]> {
  const voices: MicdropVoice[] = []
  let pageToken: string | undefined
  do {
    const params = new URLSearchParams({ page_size: '100' })
    if (pageToken) params.set('next_page_token', pageToken)
    const response = await fetch(
      `https://api.elevenlabs.io/v2/voices?${params}`,
      { headers: { 'xi-api-key': apiKey } }
    )
    if (!response.ok) throw new Error(`ElevenLabs answered ${response.status}`)
    const page = (await response.json()) as {
      voices: ElevenLabsVoice[]
      has_more?: boolean
      next_page_token?: string | null
    }
    voices.push(...page.voices.map(toMicdropVoice))
    pageToken = page.has_more ? (page.next_page_token ?? undefined) : undefined
  } while (pageToken)
  return voices
}

function toMicdropVoice(voice: ElevenLabsVoice): MicdropVoice {
  const verified = (voice.verified_languages ?? [])
    .map(({ locale, language }) => locale || language)
    .filter((code): code is string => !!code)
  const label = voice.labels?.language
  const languages = verified.length ? verified : label ? [label] : undefined
  return {
    id: voice.voice_id,
    name: voice.name,
    languages: languages && [...new Set(languages)],
    gender: voiceGender(voice.labels?.gender),
    description: voice.description || undefined,
    previewUrl: voice.preview_url || undefined,
    custom: CUSTOM_CATEGORIES.includes(voice.category ?? ''),
  }
}

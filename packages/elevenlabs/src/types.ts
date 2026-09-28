import type {
  TextToSpeechStreamRequestOutputFormat,
  VoiceSettings,
} from '@elevenlabs/elevenlabs-js/api'

export type ElevenLabsModelId =
  // Text to Dialogue WebSocket
  | 'eleven_v4_turbo'
  | 'eleven_v4'
  | 'eleven_v3_conversational'
  | 'eleven_v3'
  // Text to Speech WebSocket
  | 'eleven_flash_v2_5'
  | 'eleven_multilingual_v2'
  | 'eleven_turbo_v2_5'

export interface ElevenLabsTTSOptions {
  apiKey: string
  voiceId: string
  modelId?: ElevenLabsModelId
  language?: string
  outputFormat?: TextToSpeechStreamRequestOutputFormat
  voiceSettings?: VoiceSettings
  connectionTimeout?: number
  retryDelay?: number
  maxRetry?: number
}

export const DEFAULT_MODEL_ID = 'eleven_turbo_v2_5'
export const DEFAULT_OUTPUT_FORMAT = 'pcm_16000'

/** Eleven v3 and v4 only run on the Text to Dialogue WebSocket */
export function isDialogueModel(modelId: string): boolean {
  return modelId.startsWith('eleven_v3') || modelId.startsWith('eleven_v4')
}

// Text to Speech WebSocket

export type ElevenLabsWebSocketMessage =
  | ElevenLabsWebSocketAudioOutputMessage
  | ElevenLabsWebSocketFinalOutputMessage
  | ElevenLabsWebSocketErrorMessage

export interface ElevenLabsWebSocketAudioOutputMessage {
  audio: string
  normalizedAlignment: ElevenLabsWebSocketAudioOutputMessageAlignment | null
  alignment: ElevenLabsWebSocketAudioOutputMessageAlignment | null
  isFinal?: boolean | null
}

export interface ElevenLabsWebSocketAudioOutputMessageAlignment {
  chars: string[]
  charStartTimesMs: number[]
  charDurationsMs: number[]
}

export interface ElevenLabsWebSocketFinalOutputMessage {
  isFinal: boolean
}

export interface ElevenLabsWebSocketErrorMessage {
  message: string
  error: string
  code: number
}

// Text to Dialogue WebSocket

export interface ElevenLabsDialogueClientMessage {
  voices?: string[]
  voice_settings?: { stability?: number }
  inputs?: ElevenLabsDialogueInput[]
  flush?: boolean
  keep_alive?: boolean
}

export interface ElevenLabsDialogueInput {
  text: string
  voice_id: string
  new_turn?: boolean
}

export type ElevenLabsDialogueMessage =
  | { audio: string }
  | { is_final_audio_for_turn: boolean }
  | { is_final: boolean }
  | ElevenLabsWebSocketErrorMessage

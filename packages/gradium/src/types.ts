export type GradiumOutputFormat =
  | 'pcm'
  | 'wav'
  | 'opus'
  | 'ulaw_8000'
  | 'alaw_8000'
  | 'pcm_8000'
  | 'pcm_16000'
  | 'pcm_24000'

export type GradiumInputFormat =
  | 'pcm'
  | 'pcm_8000'
  | 'pcm_16000'
  | 'pcm_24000'
  | 'pcm_48000'
  | 'wav'
  | 'opus'
  | 'ulaw_8000'
  | 'alaw_8000'

export type GradiumRegion = 'eu' | 'us'

export interface GradiumTTSOptions {
  apiKey: string
  voiceId: string
  modelName?: string
  outputFormat?: GradiumOutputFormat
  region?: GradiumRegion
  jsonConfig?: GradiumJsonConfig
  connectionTimeout?: number
  retryDelay?: number
  maxRetry?: number
}

export interface GradiumJsonConfig {
  padding_bonus?: number // Speed control: -4.0 to 4.0
  temp?: number // Temperature: 0 to 1.4, default 0.7
  cfg_coef?: number // Voice similarity: 1.0 to 4.0, default 2.0
}

export const DEFAULT_MODEL_NAME = 'default'
export const DEFAULT_OUTPUT_FORMAT: GradiumOutputFormat = 'pcm_16000'
export const DEFAULT_INPUT_FORMAT: GradiumInputFormat = 'pcm_16000'
export const DEFAULT_REGION: GradiumRegion = 'eu'
// Gradium refuses a transcription without a language, "any" detects it
export const DEFAULT_LANGUAGE = 'any'

// Speech-to-text (ASR) types

export interface GradiumASRJsonConfig {
  language?: string
  target_language?: string
  delay_in_frames?: number // 0 to 80, each frame = 80ms
  temp?: number
  padding_bonus?: number
}

export interface GradiumSTTOptions {
  apiKey: string
  modelName?: string
  inputFormat?: GradiumInputFormat
  language?: string
  region?: GradiumRegion
  jsonConfig?: GradiumASRJsonConfig
  connectionTimeout?: number
  transcriptionTimeout?: number
  retryDelay?: number
  maxRetry?: number
}

// Client -> Server ASR messages

export interface GradiumASRSetupMessage {
  type: 'setup'
  model_name: string
  input_format: string
  json_config?: GradiumASRJsonConfig
}

export interface GradiumAudioMessage {
  type: 'audio'
  audio: string // Base64 encoded audio data
}

export interface GradiumFlushMessage {
  type: 'flush'
  flush_id: number
}

// Server -> Client ASR messages

export type GradiumASRResponse =
  | GradiumReadyResponse
  | GradiumTextResponse
  | GradiumEndTextResponse
  | GradiumStepResponse
  | GradiumFlushedResponse
  | GradiumEosResponse
  | GradiumErrorResponse

export interface GradiumTextResponse {
  type: 'text'
  text: string
  start_s?: number
  stream_id?: number
}

export interface GradiumEndTextResponse {
  type: 'end_text'
  stop_s?: number
  stream_id?: number
}

export interface GradiumStepResponse {
  type: 'step'
  vad?: Array<{ horizon_s: number; inactivity_prob: number }>
  step_idx?: number
  step_duration_s?: number
  total_duration_s?: number
}

export interface GradiumFlushedResponse {
  type: 'flushed'
  flush_id: number
}

// Client -> Server messages

export interface GradiumSetupMessage {
  type: 'setup'
  voice_id: string
  model_name: string
  output_format: string
  close_ws_on_eos?: boolean
  json_config?: GradiumJsonConfig
  client_req_id?: string
}

export interface GradiumTextMessage {
  type: 'text'
  text: string
  client_req_id?: string
}

export interface GradiumEosMessage {
  type: 'end_of_stream'
  client_req_id?: string
}

// Server -> Client messages

export type GradiumResponse =
  | GradiumReadyResponse
  | GradiumAudioResponse
  | GradiumEosResponse
  | GradiumErrorResponse

export interface GradiumReadyResponse {
  type: 'ready'
  request_id?: string
  delay_in_frames?: number // Frames of 80ms the transcription lags behind the audio
}

export interface GradiumAudioResponse {
  type: 'audio'
  audio: string // Base64 encoded PCM data
  client_req_id?: string
}

export interface GradiumEosResponse {
  type: 'end_of_stream'
  client_req_id?: string
}

export interface GradiumErrorResponse {
  type: 'error'
  message: string
  code?: number
}

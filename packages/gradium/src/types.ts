export type GradiumOutputFormat =
  | 'pcm'
  | 'wav'
  | 'opus'
  | 'ulaw_8000'
  | 'alaw_8000'
  | 'pcm_8000'
  | 'pcm_16000'
  | 'pcm_24000'

export type GradiumRegion = 'eu' | 'us'

export interface GradiumTTSOptions {
  apiKey: string
  voiceId: string
  modelName?: string
  outputFormat?: GradiumOutputFormat
  region?: GradiumRegion
  jsonConfig?: GradiumJsonConfig
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
export const DEFAULT_REGION: GradiumRegion = 'eu'

// Client -> Server messages

export interface GradiumSetupMessage {
  type: 'setup'
  voice_id: string
  model_name: string
  output_format: string
  close_ws_on_eos?: boolean
  json_config?: GradiumJsonConfig
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

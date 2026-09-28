// The voice models the page offers, shared by the page and the server.

export const VOICE_MODELS = [
  {
    id: 'eleven_v4_turbo',
    label: 'Eleven v4 Turbo, performs the audio tags',
    tags: true,
  },
  {
    id: 'eleven_flash_v2_5',
    label: 'Eleven Flash v2.5, without tags',
    tags: false,
  },
] as const

export type VoiceModel = (typeof VOICE_MODELS)[number]

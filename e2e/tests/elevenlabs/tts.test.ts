import { ElevenLabsTTS, ElevenLabsTTSOptions } from '@micdrop/elevenlabs'
import { key } from '../../src/env.js'
import { describeTTS } from '../../src/scenarios/tts.js'

// One model of each WebSocket: v4 streams a dialogue, Flash a single voice
const models: ElevenLabsTTSOptions['modelId'][] = [
  'eleven_v4_turbo',
  'eleven_flash_v2_5',
]

for (const modelId of models) {
  describeTTS(`ElevenLabsTTS ${modelId}`, {
    keys: ['ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID'],
    websocket: true,
    create: (overrides = {}) =>
      new ElevenLabsTTS({
        apiKey: key('ELEVENLABS_API_KEY'),
        voiceId: key('ELEVENLABS_VOICE_ID'),
        modelId,
        ...overrides,
      }),
  })
}

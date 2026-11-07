import { GradiumTTS } from '@micdrop/gradium'
import { key } from '../../src/env.js'
import { describeTTS } from '../../src/scenarios/tts.js'

describeTTS('GradiumTTS', {
  keys: ['GRADIUM_API_KEY', 'GRADIUM_VOICE_ID'],
  websocket: true,
  create: (overrides = {}) =>
    new GradiumTTS({
      apiKey: key('GRADIUM_API_KEY'),
      voiceId: key('GRADIUM_VOICE_ID'),
      ...overrides,
    }),
})

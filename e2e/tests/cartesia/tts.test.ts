import { CartesiaTTS } from '@micdrop/cartesia'
import { key } from '../../src/env.js'
import { describeTTS } from '../../src/scenarios/tts.js'

describeTTS('CartesiaTTS', {
  keys: ['CARTESIA_API_KEY', 'CARTESIA_VOICE_ID'],
  websocket: true,
  create: (overrides = {}) =>
    new CartesiaTTS({
      apiKey: key('CARTESIA_API_KEY'),
      voiceId: key('CARTESIA_VOICE_ID'),
      modelId: 'sonic-3.6',
      ...overrides,
    }),
})

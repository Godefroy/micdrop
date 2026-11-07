import { MistralTTS } from '@micdrop/mistral'
import { key } from '../../src/env.js'
import { describeTTS } from '../../src/scenarios/tts.js'

describeTTS('MistralTTS', {
  keys: ['MISTRAL_API_KEY'],
  create: ({ apiKey } = {}) =>
    new MistralTTS({
      apiKey: apiKey ?? key('MISTRAL_API_KEY'),
      voiceId: 'voice_3150',
    }),
})

import { OpenaiTTS } from '@micdrop/openai'
import { key } from '../../src/env.js'
import { describeTTS } from '../../src/scenarios/tts.js'

describeTTS('OpenaiTTS', {
  keys: ['OPENAI_API_KEY'],
  create: ({ apiKey } = {}) =>
    new OpenaiTTS({ apiKey: apiKey ?? key('OPENAI_API_KEY'), voice: 'marin' }),
})

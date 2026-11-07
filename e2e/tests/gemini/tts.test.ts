import { GeminiTTS } from '@micdrop/gemini'
import { key } from '../../src/env.js'
import { describeTTS } from '../../src/scenarios/tts.js'

describeTTS('GeminiTTS', {
  keys: ['GEMINI_API_KEY'],
  create: ({ apiKey } = {}) =>
    new GeminiTTS({ apiKey: apiKey ?? key('GEMINI_API_KEY') }),
})

import { Qwen3TTS } from '@micdrop/qwen-tts'
import { LOCAL_TIMEOUT, QWEN_URL, responds } from '../../src/local.js'
import { describeTTS } from '../../src/scenarios/tts.js'

describeTTS('Qwen3TTS', {
  available: await responds(QWEN_URL),
  timeout: LOCAL_TIMEOUT,
  create: () =>
    new Qwen3TTS({
      url: QWEN_URL,
      model: process.env.QWEN_MODEL,
      voice: 'Ryan',
    }),
})

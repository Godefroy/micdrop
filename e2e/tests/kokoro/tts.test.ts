import { KokoroTTS } from '@micdrop/kokoro'
import { LOCAL_TIMEOUT } from '../../src/local.js'
import { describeTTS } from '../../src/scenarios/tts.js'

describeTTS('KokoroTTS', {
  timeout: LOCAL_TIMEOUT,
  create: () => new KokoroTTS({ voice: 'americanFemale', warmup: false }),
})

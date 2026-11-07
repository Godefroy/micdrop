import { PhononTTS } from '@micdrop/phonon'
import { LOCAL_TIMEOUT } from '../../src/local.js'
import { describeTTS } from '../../src/scenarios/tts.js'

// The English model, which needs no Hugging Face token
describeTTS('PhononTTS', {
  timeout: LOCAL_TIMEOUT,
  create: () => new PhononTTS({ model: process.env.PHONON_MODEL }),
})

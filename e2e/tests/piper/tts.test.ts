import { PiperTTS } from '@micdrop/piper'
import {
  firstFile,
  hasBinary,
  LOCAL_TIMEOUT,
  PIPER_VOICES_DIR,
} from '../../src/local.js'
import { describeTTS } from '../../src/scenarios/tts.js'

const binaryPath = process.env.PIPER_BINARY || 'piper'
const voice = firstFile(PIPER_VOICES_DIR, '.onnx')

describeTTS('PiperTTS', {
  available: !!voice && hasBinary(binaryPath),
  timeout: LOCAL_TIMEOUT,
  create: () => new PiperTTS({ modelPath: voice!, binaryPath }),
})

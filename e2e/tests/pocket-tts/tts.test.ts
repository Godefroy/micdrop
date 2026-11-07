import { PocketTTS } from '@micdrop/pocket-tts'
import { existsSync } from 'node:fs'
import { LOCAL_TIMEOUT, POCKET_MODEL_DIR } from '../../src/local.js'
import { describeTTS } from '../../src/scenarios/tts.js'

describeTTS('PocketTTS', {
  available: existsSync(POCKET_MODEL_DIR),
  timeout: LOCAL_TIMEOUT,
  create: () =>
    new PocketTTS({ modelDir: POCKET_MODEL_DIR, voice: 'bria', warmup: false }),
})

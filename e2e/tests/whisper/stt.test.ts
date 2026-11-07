import { WhisperSTT } from '@micdrop/whisper'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { canSpeak, SPEECH, speakInto, speech } from '../../src/audio.js'
import { LOCAL_TIMEOUT } from '../../src/local.js'
import { describeSTT } from '../../src/scenarios/stt.js'
import { once, sleep } from '../../src/wait.js'

describeSTT('WhisperSTT', {
  timeout: LOCAL_TIMEOUT,
  create: () =>
    new WhisperSTT({ model: 'base', language: 'en', warmup: false }),
})

describe.skipIf(!canSpeak())('WhisperSTT warm-up', () => {
  it(
    'loads its model when created, so the first turn waits for nothing',
    async () => {
      const fox = await speech(SPEECH.fox)
      const stt = new WhisperSTT({ model: 'base', language: 'en' })
      try {
        // The call opens, then the user takes a while to speak
        await sleep(10_000)
        const stream = new PassThrough()
        stt.transcribe(stream)
        await speakInto(stream, fox)
        const endedAt = Date.now()
        await once(stt, 'Transcript', 30_000)

        // A model loaded on the first turn would take seconds more
        expect(Date.now() - endedAt).toBeLessThan(3000)
      } finally {
        stt.destroy()
      }
    },
    LOCAL_TIMEOUT
  )
})

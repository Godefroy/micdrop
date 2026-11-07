import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, it } from 'node:test'
import { MockTTS } from '../src/index'

const dir = mkdtempSync(join(tmpdir(), 'micdrop-mock-tts-'))
const files = [1, 2].map((i) => {
  const path = join(dir, `chunk-${i}.pcm`)
  writeFileSync(path, Buffer.alloc(320, i))
  return path
})

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function speak(tts: MockTTS) {
  const stream = new PassThrough()
  tts.speak(stream)
  stream.end('Hello')
}

describe('MockTTS', () => {
  it('emits its chunks as audio for any answer', async () => {
    const tts = new MockTTS(files)
    const chunks: Buffer[] = []
    tts.on('Audio', (chunk) => chunks.push(chunk))
    speak(tts)
    await wait(500)
    assert.deepEqual(
      chunks.map((chunk) => chunk[0]),
      [1, 2]
    )
  })

  it('stops once cancelled', async () => {
    const tts = new MockTTS(files)
    const chunks: Buffer[] = []
    tts.on('Audio', (chunk) => chunks.push(chunk))
    speak(tts)
    await wait(300)
    tts.cancel()
    await wait(300)
    assert.equal(chunks.length, 1)
  })
})

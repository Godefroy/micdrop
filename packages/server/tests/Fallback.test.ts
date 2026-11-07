import assert from 'node:assert/strict'
import { PassThrough, Readable } from 'node:stream'
import { describe, it } from 'node:test'
import { FallbackSTT, FallbackTTS, STT, TTS } from '../src/index'

const tick = () => new Promise((resolve) => setImmediate(resolve))

/** Records what each utterance carried, and fails or answers on demand */
class RecordingSTT extends STT {
  public utterances: string[][] = []

  transcribe(stream: Readable) {
    const chunks: string[] = []
    this.utterances.push(chunks)
    stream.on('data', (chunk: Buffer) => chunks.push(chunk.toString()))
  }

  fail() {
    this.emit(
      'Failed',
      this.utterances.flat().map((c) => Buffer.from(c))
    )
  }

  answer(transcript: string) {
    this.emit('Transcript', transcript)
  }
}

class RecordingTTS extends TTS {
  public texts: string[] = []
  public ended: boolean[] = []

  speak(stream: Readable) {
    const index = this.texts.push('') - 1
    this.ended.push(false)
    stream.on('data', (chunk) => (this.texts[index] += chunk.toString()))
    stream.on('end', () => (this.ended[index] = true))
  }

  cancel() {}

  fail(texts: string[]) {
    this.emit('Failed', texts)
  }
}

describe('FallbackSTT', () => {
  it('hands each waiting utterance to the next STT on its own', async () => {
    const stts: RecordingSTT[] = []
    const fallback = new FallbackSTT({
      factories: [
        () => stts[stts.push(new RecordingSTT()) - 1],
        () => stts[stts.push(new RecordingSTT()) - 1],
      ],
    })
    const transcripts: string[] = []
    fallback.on('Transcript', (t) => transcripts.push(t))

    const first = new PassThrough()
    const second = new PassThrough()
    fallback.transcribe(first)
    fallback.transcribe(second)
    first.end('A')
    second.write('B1')
    await tick()

    stts[0].fail()
    // The utterance still being spoken goes on with the next STT
    second.end('B2')
    await tick()

    assert.deepEqual(stts[1].utterances, [['A'], ['B1', 'B2']])
    stts[1].answer('a')
    stts[1].answer('b')
    assert.deepEqual(transcripts, ['a', 'b'])
  })

  it('replays nothing already transcribed', async () => {
    const stts: RecordingSTT[] = []
    const fallback = new FallbackSTT({
      factories: [
        () => stts[stts.push(new RecordingSTT()) - 1],
        () => stts[stts.push(new RecordingSTT()) - 1],
      ],
    })
    const done = new PassThrough()
    fallback.transcribe(done)
    done.end('A')
    await tick()
    stts[0].answer('a')
    stts[0].fail()
    assert.deepEqual(stts[1].utterances, [])
  })
})

describe('FallbackTTS', () => {
  it('speaks the rest of an utterance still being written', async () => {
    const ttss: RecordingTTS[] = []
    const fallback = new FallbackTTS({
      factories: [
        () => ttss[ttss.push(new RecordingTTS()) - 1],
        () => ttss[ttss.push(new RecordingTTS()) - 1],
      ],
    })
    const text = new PassThrough()
    fallback.speak(text)
    text.write('Hello ')
    await tick()

    ttss[0].fail(['Hello '])
    text.end('there')
    await tick()

    assert.deepEqual(ttss[1].texts, ['Hello there'])
    assert.deepEqual(ttss[1].ended, [true])
  })

  it('hands over the unspoken text of a finished utterance', async () => {
    const ttss: RecordingTTS[] = []
    const fallback = new FallbackTTS({
      factories: [
        () => ttss[ttss.push(new RecordingTTS()) - 1],
        () => ttss[ttss.push(new RecordingTTS()) - 1],
      ],
    })
    const text = new PassThrough()
    fallback.speak(text)
    text.end('Hello there')
    await tick()

    ttss[0].fail(['there'])
    await tick()
    assert.deepEqual(ttss[1].texts, ['there'])
    assert.deepEqual(ttss[1].ended, [true])
  })

  it('speaks nothing of a cancelled utterance', async () => {
    const ttss: RecordingTTS[] = []
    const fallback = new FallbackTTS({
      factories: [
        () => ttss[ttss.push(new RecordingTTS()) - 1],
        () => ttss[ttss.push(new RecordingTTS()) - 1],
      ],
    })
    const text = new PassThrough()
    fallback.speak(text)
    text.write('Hello ')
    fallback.cancel()
    ttss[0].fail([])
    await tick()
    assert.deepEqual(ttss[1].texts, [])
  })
})

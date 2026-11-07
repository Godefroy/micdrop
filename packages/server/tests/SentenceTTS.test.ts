import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { describe, it } from 'node:test'
import { SentenceTTS } from '../src/index'

/** Synthesizes each sentence after a delay, as its own text in the audio */
class SlowTTS extends SentenceTTS {
  public synthesized: string[] = []

  protected async synthesize(text: string, signal: AbortSignal) {
    await new Promise((resolve) => setTimeout(resolve, 20))
    if (signal.aborted) return undefined
    this.synthesized.push(text.trim())
    return Buffer.from(text.trim())
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function speak(tts: SentenceTTS, text: string) {
  const stream = new PassThrough()
  tts.speak(stream)
  stream.end(text)
}

describe('SentenceTTS', () => {
  it('speaks the sentences in order', async () => {
    const tts = new SlowTTS()
    const heard: string[] = []
    tts.on('Audio', (audio) => heard.push(audio.toString()))
    speak(tts, 'One is here. Two is there. Three is everywhere.')
    await wait(150)
    assert.deepEqual(heard, [
      'One is here.',
      'Two is there.',
      'Three is everywhere.',
    ])
  })

  it('drops what is left of an answer another one takes over', async () => {
    const tts = new SlowTTS()
    const heard: string[] = []
    tts.on('Audio', (audio) => heard.push(audio.toString()))
    speak(tts, 'One is here. Two is there. Three is everywhere.')
    await wait(30)
    speak(tts, 'Something else entirely.')
    await wait(150)
    assert.deepEqual(heard, ['One is here.', 'Something else entirely.'])
  })

  it('keeps speaking through an answer without a word', async () => {
    const tts = new SlowTTS()
    const heard: string[] = []
    tts.on('Audio', (audio) => heard.push(audio.toString()))
    speak(tts, 'One is here. Two is there.')
    await wait(10)
    const empty = new PassThrough()
    tts.speak(empty)
    empty.end()
    await wait(150)
    assert.deepEqual(heard, ['One is here.', 'Two is there.'])
  })
})

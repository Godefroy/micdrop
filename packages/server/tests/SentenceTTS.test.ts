import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { describe, it } from 'node:test'
import { SentenceTTS } from '../src/index'

interface Synthesis {
  text: string
  signal: AbortSignal
  finish: () => void
}

/**
 * Synthesizes each sentence as its own text in the audio, once the test lets
 * it finish, so no assertion depends on how fast the machine is
 */
class ControlledTTS extends SentenceTTS {
  public pending: Synthesis[] = []

  protected synthesize(text: string, signal: AbortSignal) {
    return new Promise<Buffer | undefined>((resolve) => {
      this.pending.push({
        text: text.trim(),
        signal,
        finish: () =>
          resolve(signal.aborted ? undefined : Buffer.from(text.trim())),
      })
    })
  }

  /** Waits for the next sentence to reach the model, and returns it */
  async next(): Promise<Synthesis> {
    await until(() => this.pending.length > 0, 'a sentence to synthesize')
    return this.pending.shift()!
  }
}

/** Lets the event loop run until a condition holds */
async function until(check: () => boolean, what: string) {
  for (let i = 0; i < 1000; i++) {
    if (check()) return
    await new Promise((resolve) => setImmediate(resolve))
  }
  throw new Error(`Timed out waiting for ${what}`)
}

const flush = () => new Promise((resolve) => setImmediate(resolve))

function speak(tts: SentenceTTS, text: string) {
  const stream = new PassThrough()
  tts.speak(stream)
  stream.end(text)
}

function listen(tts: SentenceTTS): string[] {
  const heard: string[] = []
  tts.on('Audio', (audio) => heard.push(audio.toString()))
  return heard
}

describe('SentenceTTS', () => {
  it('speaks the sentences in order, one at a time', async () => {
    const tts = new ControlledTTS()
    const heard = listen(tts)
    speak(tts, 'One is here. Two is there. Three is everywhere.')

    for (const sentence of ['One is here.', 'Two is there.']) {
      const synthesis = await tts.next()
      assert.equal(synthesis.text, sentence)
      // The next sentence waits for this one to be done
      await flush()
      assert.equal(tts.pending.length, 0)
      synthesis.finish()
    }
    ;(await tts.next()).finish()
    await until(() => heard.length === 3, 'the third sentence')

    assert.deepEqual(heard, [
      'One is here.',
      'Two is there.',
      'Three is everywhere.',
    ])
  })

  it('drops what is left of an answer another one takes over', async () => {
    const tts = new ControlledTTS()
    const heard = listen(tts)
    speak(tts, 'One is here. Two is there. Three is everywhere.')
    ;(await tts.next()).finish()
    const second = await tts.next()

    speak(tts, 'Something else entirely.')
    await until(() => second.signal.aborted, 'the second sentence to stop')
    second.finish()
    ;(await tts.next()).finish()
    await until(() => heard.length === 2, 'the new answer')
    await flush()

    assert.deepEqual(heard, ['One is here.', 'Something else entirely.'])
    assert.equal(tts.pending.length, 0)
  })

  it('keeps speaking through an answer without a word', async () => {
    const tts = new ControlledTTS()
    const heard = listen(tts)
    speak(tts, 'One is here. Two is there.')
    const first = await tts.next()

    const empty = new PassThrough()
    tts.speak(empty)
    empty.end()
    await flush()
    assert.equal(first.signal.aborted, false)

    first.finish()
    ;(await tts.next()).finish()
    await until(() => heard.length === 2, 'the second sentence')

    assert.deepEqual(heard, ['One is here.', 'Two is there.'])
  })
})

import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { describe, it } from 'node:test'
import { Agent } from '../src/index'

/** Writes a word, then waits for the test to let it finish */
class SlowAgent extends Agent {
  public signals: AbortSignal[] = []
  public finish: () => void = () => {}

  constructor() {
    super({ systemPrompt: '' })
  }

  protected async generateAnswer(stream: PassThrough, signal: AbortSignal) {
    this.signals.push(signal)
    stream.write('Hello')
    await new Promise<void>((resolve) => (this.finish = resolve))
    if (signal.aborted) return
    this.addAssistantMessage('Hello')
  }
}

const tick = () => new Promise((resolve) => setImmediate(resolve))

function read(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve) => {
    let text = ''
    stream.on('data', (chunk) => (text += chunk.toString()))
    stream.on('end', () => resolve(text))
  })
}

describe('Agent', () => {
  it('is answering until the answer is written', async () => {
    const agent = new SlowAgent()
    assert.equal(agent.isAnswering, false)
    const text = read(agent.answer())
    assert.equal(agent.isAnswering, true)
    await tick()
    agent.finish()
    assert.equal(await text, 'Hello')
    assert.equal(agent.isAnswering, false)
    assert.equal((agent.conversation.at(-1) as any)?.content, 'Hello')
  })

  it('aborts the signal of a cancelled answer', async () => {
    const agent = new SlowAgent()
    agent.answer()
    await tick()
    agent.cancel()
    assert.equal(agent.signals[0].aborted, true)
    assert.equal(agent.isAnswering, false)
    agent.finish()
    await tick()
    assert.equal(agent.conversation.length, 1)
  })

  it('aborts the previous answer when a new one starts', async () => {
    const agent = new SlowAgent()
    agent.answer()
    await tick()
    const firstFinish = agent.finish
    agent.answer()
    await tick()
    assert.equal(agent.signals[0].aborted, true)
    assert.equal(agent.signals[1].aborted, false)
    // The first answer ending leaves the second one going
    firstFinish()
    await tick()
    assert.equal(agent.isAnswering, true)
  })

  it('never calls generateAnswer once cancelled during onBeforeAnswer', async () => {
    let release: () => void = () => {}
    const agent = new SlowAgent()
    ;(agent as any).options.onBeforeAnswer = () =>
      new Promise<void>((resolve) => (release = resolve))
    agent.answer()
    await tick()
    agent.cancel()
    release()
    await tick()
    await tick()
    assert.equal(agent.signals.length, 0)
  })
})

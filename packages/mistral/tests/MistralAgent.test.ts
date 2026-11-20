import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MistralAgent } from '../src/MistralAgent'

/** Streams these deltas as the SDK does, one event each */
function stubStream(agent: MistralAgent, deltas: unknown[]) {
  ;(agent as any).mistral = {
    chat: {
      stream: async () =>
        (async function* () {
          for (const delta of deltas) {
            yield { data: { choices: [{ index: 0, delta }] } }
          }
        })(),
    },
  }
}

async function answer(deltas: unknown[]) {
  const agent = new MistralAgent({ apiKey: 'test', systemPrompt: 'Be brief' })
  agent.addUserMessage('Bonjour, comment ça va ?')
  stubStream(agent, deltas)
  let spoken = ''
  const stream = agent.answer()
  stream.on('data', (chunk: Buffer) => (spoken += chunk.toString()))
  await new Promise((resolve) => stream.on('end', resolve))
  const last = agent.conversation[agent.conversation.length - 1]
  return { spoken, message: 'content' in last ? last.content : '' }
}

describe('MistralAgent', () => {
  it('answers with the text of a model that streams strings', async () => {
    const { spoken, message } = await answer([
      { role: 'assistant', content: '' },
      { content: 'Bonjour' },
      { content: ', ça va bien.' },
    ])
    assert.equal(spoken, 'Bonjour, ça va bien.')
    assert.equal(message, 'Bonjour, ça va bien.')
  })

  it('keeps the first word a reasoning model streams in an array', async () => {
    const thinking = (text: string) => ({
      type: 'thinking',
      thinking: [{ type: 'text', text }],
    })
    const { spoken, message } = await answer([
      { role: 'assistant', content: '' },
      { content: [thinking('The user is greeting me')] },
      { content: [thinking(' in French.')] },
      { content: [thinking('.'), { type: 'text', text: 'Bonjour' }] },
      { content: [{ type: 'text', text: ' !' }] },
      { content: ' Ça va bien.' },
    ])
    assert.equal(spoken, 'Bonjour ! Ça va bien.')
    assert.equal(message, 'Bonjour ! Ça va bien.')
  })
})

describe('MistralAgent extract', () => {
  it('speaks the text before the JSON once', async () => {
    const agent = new MistralAgent({
      apiKey: 'test',
      systemPrompt: 'Be brief',
      extract: { saveInMetadata: true },
    })
    agent.addUserMessage('Hi')
    stubStream(agent, [
      { content: 'Hello' },
      { content: ' there. {"mood":' },
      { content: '"happy"}' },
    ])
    let spoken = ''
    const stream = agent.answer()
    stream.on('data', (chunk: Buffer) => (spoken += chunk.toString()))
    await new Promise((resolve) => stream.on('end', resolve))
    const last = agent.conversation[agent.conversation.length - 1] as any

    assert.equal(spoken, 'Hello there.')
    assert.equal(last.content, 'Hello there.')
    assert.deepEqual(last.metadata, { extracted: { mood: 'happy' } })
  })
})

describe('MistralAgent reasoning effort', () => {
  it('sends the effort of the settings', async () => {
    const bodies: any[] = []
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      const request = new Request(input, init)
      bodies.push(JSON.parse(await request.text()))
      return new Response('data: [DONE]\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      })
    }) as typeof fetch
    try {
      const agent = new MistralAgent({
        apiKey: 'test',
        systemPrompt: '',
        settings: { reasoningEffort: 'none' },
      })
      agent.addUserMessage('Hi')
      const stream = agent.answer()
      stream.resume()
      await new Promise((resolve) => stream.on('end', resolve))
    } finally {
      globalThis.fetch = realFetch
    }
    assert.equal(bodies[0]?.reasoning_effort, 'none')
    assert.equal(bodies[0]?.model, 'mistral-medium-latest')
  })
})

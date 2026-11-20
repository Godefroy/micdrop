import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { GeminiAgent } from '../src/GeminiAgent'

/** Streams these events as the Interactions API does */
async function answer(events: unknown[]) {
  const agent = new GeminiAgent({ apiKey: 'test', systemPrompt: 'Be brief' })
  ;(agent as any).genai = {
    interactions: {
      create: async () =>
        (async function* () {
          yield* events
        })(),
    },
  }
  agent.addUserMessage('Bonjour, comment ça va ?')
  let spoken = ''
  const stream = agent.answer()
  stream.on('data', (chunk: Buffer) => (spoken += chunk.toString()))
  await new Promise((resolve) => stream.on('end', resolve))
  const last = agent.conversation[agent.conversation.length - 1]
  return { spoken, message: 'content' in last ? last.content : '' }
}

const text = (index: number, text: string) => ({
  event_type: 'step.delta',
  index,
  delta: { type: 'text', text },
})

describe('GeminiAgent', () => {
  it('answers with the text deltas of the model output', async () => {
    const { spoken, message } = await answer([
      { event_type: 'step.start', index: 0, step: { type: 'thought' } },
      { event_type: 'step.stop', index: 0 },
      { event_type: 'step.start', index: 1, step: { type: 'model_output' } },
      text(1, 'Bonjour'),
      text(1, ', ça va bien.'),
      { event_type: 'step.stop', index: 1 },
    ])
    assert.equal(spoken, 'Bonjour, ça va bien.')
    assert.equal(message, 'Bonjour, ça va bien.')
  })

  it('keeps the text a step opens with', async () => {
    const { spoken, message } = await answer([
      {
        event_type: 'step.start',
        index: 0,
        step: {
          type: 'model_output',
          content: [{ type: 'text', text: 'Bonjour' }],
        },
      },
      text(0, ', ça va bien.'),
      { event_type: 'step.stop', index: 0 },
    ])
    assert.equal(spoken, 'Bonjour, ça va bien.')
    assert.equal(message, 'Bonjour, ça va bien.')
  })
})

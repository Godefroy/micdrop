import type { Agent, AgentOptions } from '@micdrop/server'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { hasKeys } from '../env.js'
import { captureLogs } from '../logs.js'
import { sleep, waitFor } from '../wait.js'

export interface AgentScenarioOptions {
  /** Keys the provider needs, the scenarios are skipped without them */
  keys: string[]
  create(options: Pick<AgentOptions, 'systemPrompt' | 'extract'>): Agent
}

const BRIEF = 'You are a voice assistant. Answer in one short sentence.'

function read(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve) => {
    let text = ''
    stream.on('data', (chunk) => (text += chunk.toString()))
    stream.on('end', () => resolve(text))
  })
}

function assistantMessages(agent: Agent): string[] {
  return agent.conversation
    .filter((item) => item.role === 'assistant')
    .map((item) => ('content' in item ? item.content : ''))
}

/** What every agent has to do in a call */
export function describeAgent(name: string, options: AgentScenarioOptions) {
  describe.skipIf(!hasKeys(...options.keys))(name, () => {
    const instances: Agent[] = []
    const create = (
      agentOptions: Pick<AgentOptions, 'systemPrompt' | 'extract'> = {
        systemPrompt: BRIEF,
      }
    ) => {
      const agent = captureLogs(options.create(agentOptions), name)
      instances.push(agent)
      return agent
    }
    afterEach(() => instances.splice(0).forEach((agent) => agent.destroy()))

    it('answers and records its answer', async () => {
      const agent = create()
      agent.addUserMessage('What is the capital of France?')

      const text = await read(agent.answer())

      expect(text).toMatch(/paris/i)
      expect(assistantMessages(agent)).toEqual([text])
      expect(agent.isAnswering).toBe(false)
    })

    it('opens the call before anything was said', async () => {
      // What generateFirstMessage asks for: the system prompt alone
      const agent = create({
        systemPrompt:
          'You are the voice assistant of a bakery. Greet the caller in one short sentence.',
      })
      let failed = false
      agent.on('Failed', () => (failed = true))

      const text = await read(agent.answer())

      expect(failed).toBe(false)
      expect(text.trim()).not.toBe('')
      expect(assistantMessages(agent)).toEqual([text])
    })

    it('records nothing once cancelled', async () => {
      const agent = create()
      agent.addUserMessage('Count from one to fifty, in words.')

      const stream = agent.answer()
      await new Promise((resolve) => stream.once('data', resolve))
      agent.cancel()
      await sleep(3000)

      expect(agent.isAnswering).toBe(false)
      expect(assistantMessages(agent)).toEqual([])
    })

    it('calls a tool and answers with its result', async () => {
      const agent = create()
      const cities: string[] = []
      agent.addTool({
        name: 'get_weather',
        description: 'Gives the current weather in a city',
        inputSchema: z.object({ city: z.string() }),
        execute: ({ city }) => {
          cities.push(city)
          return { temperature: 23, sky: 'sunny' }
        },
      })
      agent.addUserMessage('What is the weather like in Lyon right now?')

      const text = await read(agent.answer())

      expect(cities).toHaveLength(1)
      expect(cities[0]).toMatch(/lyon/i)
      // The model read the result sent back to it, arguments included
      expect(text).toMatch(/23/)
      await waitFor(() => !agent.isAnswering, 'the answer to end', 5000)
    })

    it('extracts a value written at the end of its answer', async () => {
      const extracted: unknown[] = []
      const agent = create({
        systemPrompt:
          'You are a voice assistant. When the user names a city, thank them, ' +
          'then append its city and country names as compact JSON, with the ' +
          'keys "city" and "country", without a code block.',
        extract: {
          json: true,
          saveInMetadata: true,
          callback: (value: unknown) => extracted.push(value),
        },
      })
      agent.addUserMessage('I live in Paris.')

      const text = await read(agent.answer())

      expect(extracted).toHaveLength(1)
      expect(extracted[0]).toMatchObject({
        city: expect.stringMatching(/paris/i),
      })
      // The JSON stays out of what is spoken and recorded
      expect(text).not.toContain('{')
      const message = agent.conversation.at(-1)
      expect(message?.role).toBe('assistant')
      expect(
        message && 'metadata' in message && message.metadata?.extracted
      ).toBeTruthy()
    })
  })
}

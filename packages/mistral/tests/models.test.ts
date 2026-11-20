import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MistralAgent } from '../src/MistralAgent'
import { MistralSTT } from '../src/MistralSTT'

const chat = { completion_chat: true, function_calling: true }

describe('Mistral listModels', () => {
  it('lists each model once, under its -latest alias, for its component', async () => {
    const data = [
      {
        id: 'mistral-medium-3-5',
        aliases: ['mistral-medium-latest'],
        capabilities: { ...chat, reasoning: true },
      },
      {
        id: 'mistral-medium-latest',
        aliases: ['mistral-medium-3-5'],
        capabilities: { ...chat, reasoning: true },
      },
      {
        id: 'mistral-large-2512',
        aliases: [],
        capabilities: chat,
        deprecation: '2027-03-01T00:00:00Z',
      },
      { id: 'mistral-embed', aliases: [], capabilities: {} },
      {
        id: 'voxtral-realtime-3',
        aliases: [],
        capabilities: { audio_transcription_realtime: true },
        audio_transcription_capabilities: { languages: ['en', 'fr'] },
      },
    ]
    const realFetch = globalThis.fetch
    globalThis.fetch = (async () => Response.json({ data })) as typeof fetch
    try {
      const apiKey = 'models-test'
      assert.deepEqual(
        (await MistralAgent.listModels({ apiKey })).map(
          ({ id, aliases, reasoning, deprecated, shutdownDate }) => ({
            id,
            aliases,
            reasoning,
            deprecated,
            shutdownDate,
          })
        ),
        [
          {
            id: 'mistral-medium-latest',
            aliases: ['mistral-medium-3-5'],
            reasoning: true,
            deprecated: false,
            shutdownDate: undefined,
          },
          {
            id: 'mistral-large-2512',
            aliases: [],
            reasoning: false,
            deprecated: true,
            shutdownDate: '2027-03-01',
          },
        ]
      )
      const stt = await MistralSTT.listModels({ apiKey })
      assert.deepEqual(
        stt.map(({ id, languages }) => ({ id, languages })),
        [{ id: 'voxtral-realtime-3', languages: ['en', 'fr'] }]
      )
    } finally {
      globalThis.fetch = realFetch
    }
  })
})

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MistralTTS } from '../src/MistralTTS'

describe('MistralTTS.listVoices', () => {
  it('reads every page, by offset', async () => {
    const all = Array.from({ length: 150 }, (_, i) => ({
      id: `id-${i}`,
      slug: i < 140 ? `voice_${i}` : null,
      name: `Voice ${i}`,
      languages: ['en_us'],
      gender: i % 2 ? 'male' : 'female',
      type: i < 140 ? 'preset' : 'custom',
    }))
    const urls: string[] = []
    const realFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      urls.push(url.search)
      const offset = Number(url.searchParams.get('offset'))
      const limit = Number(url.searchParams.get('limit'))
      return Response.json({
        items: all.slice(offset, offset + limit),
        total: all.length,
      })
    }) as typeof fetch
    try {
      const voices = await MistralTTS.listVoices({ apiKey: 'test' })
      assert.equal(voices.length, 150)
      assert.equal(new Set(voices.map((voice) => voice.id)).size, 150)
      assert.deepEqual(voices[0], {
        id: 'voice_0',
        name: 'Voice 0',
        languages: ['en-US'],
        gender: 'female',
        description: undefined,
        custom: false,
      })
      // A voice of the account goes by its id
      assert.equal(voices[145].id, 'id-145')
      assert.equal(voices[145].custom, true)
      assert.deepEqual(urls, ['?offset=0&limit=100', '?offset=100&limit=100'])
    } finally {
      globalThis.fetch = realFetch
    }
  })
})

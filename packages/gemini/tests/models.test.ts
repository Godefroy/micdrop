import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { GeminiAgent } from '../src/GeminiAgent'
import { GeminiLive } from '../src/GeminiLive'
import { GeminiSTT } from '../src/GeminiSTT'
import { GeminiTTS } from '../src/GeminiTTS'

const model = (id: string, methods: string[], thinking = false) => ({
  name: `models/${id}`,
  supportedGenerationMethods: methods,
  thinking,
})

describe('Gemini listModels', () => {
  it('sorts each model into the component that runs it', async () => {
    const models = [
      model('gemini-3.8-flash', ['generateContent'], true),
      model('gemini-3.8-flash-tts', ['generateContent']),
      model('gemini-3.8-live', ['bidiGenerateContent']),
      model('gemini-3.5-transcribe-live', ['bidiGenerateContent']),
      model('gemini-3.5-live-translate-preview', ['bidiGenerateContent']),
      model('gemini-3.1-flash-image', ['generateContent']),
      model('gemini-embedding-2', ['embedContent']),
    ]
    const realFetch = globalThis.fetch
    globalThis.fetch = (async () => Response.json({ models })) as typeof fetch
    try {
      const options = { apiKey: 'models-test' }
      const ids = async (list: Promise<{ id: string }[]>) =>
        (await list).map(({ id }) => id)
      assert.deepEqual(await ids(GeminiAgent.listModels(options)), [
        'gemini-3.8-flash',
      ])
      assert.deepEqual(await ids(GeminiTTS.listModels(options)), [
        'gemini-3.8-flash-tts',
      ])
      assert.deepEqual(await ids(GeminiLive.listModels(options)), [
        'gemini-3.8-live',
      ])
      assert.deepEqual(await ids(GeminiSTT.listModels(options)), [
        'gemini-3.5-transcribe-live',
      ])
      assert.equal((await GeminiAgent.listModels(options))[0].reasoning, true)
    } finally {
      globalThis.fetch = realFetch
    }
  })
})

import { GeminiLive } from '@micdrop/gemini'
import { OpenaiRealtime } from '@micdrop/openai'
import { Realtime } from '@micdrop/server'
import { getSystemPrompt } from './agents'
import { ProviderRegistry } from './types'

/**
 * Models that hear the user and answer with their own voice, each one running
 * the whole call in place of an agent, a speech to text and a text to speech.
 *
 * They share the system prompt, the automatic prompts and the tools of the
 * agents, which is what makes a realtime call comparable to a pipeline one.
 */
const realtime: ProviderRegistry<Realtime> = {
  openai: {
    label: 'OpenAI Realtime',
    requiredEnv: ['OPENAI_API_KEY'],
    models: [
      { id: 'gpt-realtime-2.1', label: 'gpt-realtime-2.1' },
      { id: 'gpt-realtime-mini', label: 'gpt-realtime-mini' },
    ],
    defaultModel: 'gpt-realtime-2.1',
    create: ({ lang, model, auto, prompt }) =>
      new OpenaiRealtime({
        apiKey: process.env.OPENAI_API_KEY || '',
        model,
        // Transcription takes the language alone, not the locale
        language: lang.split('-')[0],
        systemPrompt: getSystemPrompt(lang, prompt),
        ...auto,
      }),
  },

  gemini: {
    label: 'Gemini Live',
    requiredEnv: ['GEMINI_API_KEY'],
    models: [
      { id: 'gemini-3.8-live', label: 'gemini-3.8-live' },
      {
        id: 'gemini-3.8-live-extended-thinking',
        label: 'gemini-3.8-live-extended-thinking',
      },
    ],
    defaultModel: 'gemini-3.8-live',
    create: ({ lang, model, auto, prompt }) =>
      new GeminiLive({
        apiKey: process.env.GEMINI_API_KEY || '',
        model,
        // The model reasoning at length is the one refusing to start without
        // a level, the other one refuses any
        thinkingLevel: model?.includes('extended-thinking') ? 'low' : undefined,
        systemPrompt: getSystemPrompt(lang, prompt),
        ...auto,
      }),
  },
}

export default realtime

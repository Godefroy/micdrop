import { GeminiSTT } from '@micdrop/gemini'
import { GladiaSTT } from '@micdrop/gladia'
import { GradiumSTT } from '@micdrop/gradium'
import { MistralSTT } from '@micdrop/mistral'
import { OpenaiSTT } from '@micdrop/openai'
import { FallbackSTT, MockSTT, STT } from '@micdrop/server'
import { WHISPER_MODEL_INFO, WhisperSTT } from '@micdrop/whisper'
import { listedModels } from './models'
import { ProviderRegistry } from './types'

const speech2Text: ProviderRegistry<STT> = {
  mock: {
    label: 'Mock',
    description: 'Canned transcripts, no model called',
    create: () => new MockSTT(),
  },

  gladia: {
    label: 'Gladia',
    requiredEnv: ['GLADIA_API_KEY'],
    create: () =>
      new GladiaSTT({
        apiKey: process.env.GLADIA_API_KEY || '',
        settings: {
          realtime_processing: {
            custom_vocabulary: true,
            custom_vocabulary_config: {
              vocabulary: ['Micdrop'],
            },
          },
        },
      }),
  },

  openai: {
    label: 'OpenAI',
    requiredEnv: ['OPENAI_API_KEY'],
    models: listedModels(
      () => OpenaiSTT.listModels({ apiKey: process.env.OPENAI_API_KEY || '' }),
      ['gpt-live-transcribe', 'gpt-transcribe']
    ),
    defaultModel: 'gpt-live-transcribe',
    create: ({ model }) =>
      new OpenaiSTT({
        apiKey: process.env.OPENAI_API_KEY || '',
        model,
      }),
  },

  mistral: {
    label: 'Mistral',
    requiredEnv: ['MISTRAL_API_KEY'],
    // Only the realtime Voxtral models answer on the streaming endpoint
    models: listedModels(
      () => MistralSTT.listModels({ apiKey: process.env.MISTRAL_API_KEY || '' }),
      ['voxtral-mini-transcribe-realtime-3-0']
    ),
    defaultModel: 'voxtral-mini-transcribe-realtime-3-0',
    create: ({ model }) =>
      new MistralSTT({
        apiKey: process.env.MISTRAL_API_KEY || '',
        model,
      }),
  },

  gemini: {
    label: 'Gemini',
    requiredEnv: ['GEMINI_API_KEY'],
    models: listedModels(
      () => GeminiSTT.listModels({ apiKey: process.env.GEMINI_API_KEY || '' }),
      ['gemini-3.5-transcribe-live']
    ),
    defaultModel: 'gemini-3.5-transcribe-live',
    create: ({ lang, model }) =>
      new GeminiSTT({
        apiKey: process.env.GEMINI_API_KEY || '',
        model,
        language: lang,
        vocabulary: ['Micdrop'],
      }),
  },

  gradium: {
    label: 'Gradium',
    requiredEnv: ['GRADIUM_API_KEY'],
    create: () =>
      new GradiumSTT({
        apiKey: process.env.GRADIUM_API_KEY || '',
      }),
  },

  // Local: the weights are downloaded on first use and kept in the
  // Transformers.js cache, then shared by every call of the process.
  whisper: {
    label: 'Whisper',
    local: true,
    models: Object.entries(WHISPER_MODEL_INFO).map(([id, info]) => ({
      id,
      label: info.label,
      language: info.language,
    })),
    defaultModel: 'base',
    create: ({ lang, model }) =>
      new WhisperSTT({
        model,
        // Whisper wants a bare language code, the call carries a full locale
        language: lang.split('-')[0],
      }),
  },

  fallback: {
    label: 'Fallback',
    description: 'Gladia, then OpenAI',
    requiredEnv: ['GLADIA_API_KEY', 'OPENAI_API_KEY'],
    create: (context) =>
      new FallbackSTT({
        factories: [
          () => speech2Text.gladia.create(context),
          // Each one keeps its own default model, the selected one belongs to
          // the provider the client picked
          () =>
            speech2Text.openai.create({
              ...context,
              model: speech2Text.openai.defaultModel,
            }),
        ],
      }),
  },
}

export default speech2Text

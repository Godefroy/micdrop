import { CartesiaLanguage, CartesiaTTS } from '@micdrop/cartesia'
import { ElevenLabsTTS, ElevenLabsTTSOptions } from '@micdrop/elevenlabs'
import { GeminiTTS } from '@micdrop/gemini'
import { GradiumTTS } from '@micdrop/gradium'
import { MistralTTS } from '@micdrop/mistral'
import { KOKORO_VOICE_IDS, KokoroTTS } from '@micdrop/kokoro'
import { OpenaiTTS } from '@micdrop/openai'
import {
  getHubToken,
  PHONON_MODELS,
  PHONON_VOICES,
  PhononLanguage,
  PhononTTS,
} from '@micdrop/phonon'
import { PiperTTS } from '@micdrop/piper'
import { BUNDLED_VOICES, PocketTTS } from '@micdrop/pocket-tts'
import { QWEN_SPEAKERS, Qwen3TTS } from '@micdrop/qwen-tts'
import { FallbackTTS, MicdropVoice, MockTTS, TTS } from '@micdrop/server'
import { existsSync, readdirSync } from 'fs'
import path from 'path'
import { listedModels } from './models'
import { ProviderRegistry, VoiceOption } from './types'

/**
 * The voices a package lists, as the select shows them.
 *
 * A voice of a hosted provider reads every language of its model, so it only
 * says what it speaks best. A local voice speaks its own language alone, which
 * `setsLanguage` turns into the language of the call.
 */
function toVoiceOptions(
  voices: MicdropVoice[],
  { setsLanguage = false } = {}
): VoiceOption[] {
  return voices.map((voice) => ({
    id: voice.id,
    label: voice.name,
    language:
      setsLanguage && voice.languages?.length === 1
        ? voice.languages[0]
        : undefined,
    languages: voice.languages,
    gender: voice.gender,
    description: voice.description,
    previewUrl: voice.previewUrl,
    custom: voice.custom,
  }))
}

// Where the Pocket TTS archive was extracted, see the README of
// @micdrop/pocket-tts
const POCKET_MODEL_DIR =
  process.env.POCKET_MODEL_DIR ||
  path.join(__dirname, '../../models/sherpa-onnx-pocket-tts-int8-2026-01-26')

// Phonon model for every voice, a Hugging Face repo or a folder. When unset,
// English voices speak with Phonon 31M and the others with the 40M model of
// their language, which is gated: see the README of @micdrop/phonon
const PHONON_MODEL = process.env.PHONON_MODEL

/** Languages the demo can speak with Phonon. */
function getPhononLanguages(): string[] {
  if (!PHONON_MODEL) {
    return getHubToken() ? ['en', 'fr', 'de', 'es', 'pt'] : ['en']
  }
  const known = Object.values(PHONON_MODELS).find(
    ({ model }) => model === PHONON_MODEL
  )
  return known?.languages ?? ['en', 'fr', 'de', 'es', 'pt']
}

/** Model a voice speaks with, the 40M of its language unless forced. */
function getPhononModel(voice?: string): string | undefined {
  if (PHONON_MODEL) return PHONON_MODEL
  const language = PHONON_VOICES.find(({ name }) => name === voice)?.language
  if (!language || language === 'en') return
  return PHONON_MODELS[
    `phonon-40m-${language as Exclude<PhononLanguage, 'en' | 'none'>}`
  ].model
}

function listPhononVoices(): VoiceOption[] {
  const languages = getPhononLanguages()
  return PHONON_VOICES.filter(({ language }) =>
    languages.includes(language)
  ).map(({ name, language, locale }) => {
    // "characters" are English voices, without a region of their own
    const region = locale.split('-')[1]
    return {
      id: name,
      label: name,
      language: region ? `${language}-${region.toUpperCase()}` : language,
    }
  })
}

// Where the Piper voices were downloaded, see the README of @micdrop/piper
const PIPER_VOICES_DIR =
  process.env.PIPER_VOICES_DIR || path.join(__dirname, '../../voices')

// Where the mlx-audio server holding Qwen3-TTS answers, see the README of
// @micdrop/qwen-tts
const QWEN_URL = process.env.QWEN_URL || 'http://localhost:8000'

/** Whether the mlx-audio server is up, checked before the call starts. */
async function isQwenServerUp(): Promise<boolean> {
  try {
    const response = await fetch(QWEN_URL, {
      signal: AbortSignal.timeout(500),
    })
    return response.ok
  } catch {
    return false
  }
}

/**
 * Piper voices found on disk.
 *
 * A voice is a pair of files named after its language and its speaker, such as
 * `fr_FR-siwis-medium.onnx`, so the locale comes straight from the file name.
 */
function listPiperVoices(): VoiceOption[] {
  if (!existsSync(PIPER_VOICES_DIR)) return []
  return readdirSync(PIPER_VOICES_DIR)
    .filter((file) => file.endsWith('.onnx'))
    .map((file) => {
      const name = file.replace(/\.onnx$/, '')
      const [locale] = name.split('-')
      return {
        id: file,
        label: name,
        language: locale.replace('_', '-'),
      }
    })
}

const text2speech: ProviderRegistry<TTS> = {
  mock: {
    label: 'Mock',
    description: 'Recorded chunks, no model called',
    create: () =>
      new MockTTS([
        path.join(__dirname, '../../../client/public/chunk-1.wav'),
        path.join(__dirname, '../../../client/public/chunk-2.wav'),
      ]),
  },

  // Eleven v4 Turbo starts speaking soonest. Both v4 models perform the audio
  // tags an LLM writes, such as [laughs], which the older ones read out. The
  // voices are the ones of the account, ELEVENLABS_VOICE_ID picks the default.
  elevenlabs: {
    label: 'ElevenLabs',
    requiredEnv: ['ELEVENLABS_API_KEY'],
    models: listedModels(
      () =>
        ElevenLabsTTS.listModels({
          apiKey: process.env.ELEVENLABS_API_KEY || '',
        }),
      ['eleven_v4_turbo', 'eleven_v4', 'eleven_flash_v2_5']
    ),
    defaultModel: 'eleven_v4_turbo',
    voices: async (_model, lang) =>
      toVoiceOptions(
        await ElevenLabsTTS.listVoices({
          apiKey: process.env.ELEVENLABS_API_KEY || '',
          language: lang,
        })
      ),
    defaultVoice: process.env.ELEVENLABS_VOICE_ID,
    create: ({ model, voice }) =>
      new ElevenLabsTTS({
        apiKey: process.env.ELEVENLABS_API_KEY || '',
        voiceId: voice || process.env.ELEVENLABS_VOICE_ID || '',
        modelId: model as ElevenLabsTTSOptions['modelId'],
      }),
  },

  // The voices of the account and the public ones, CARTESIA_VOICE_ID picks
  // the default
  cartesia: {
    label: 'Cartesia',
    requiredEnv: ['CARTESIA_API_KEY'],
    models: listedModels(
      () =>
        CartesiaTTS.listModels({ apiKey: process.env.CARTESIA_API_KEY || '' }),
      ['sonic-3.6']
    ),
    defaultModel: 'sonic-3.6',
    voices: async (_model, lang) =>
      toVoiceOptions(
        await CartesiaTTS.listVoices({
          apiKey: process.env.CARTESIA_API_KEY || '',
          language: lang,
        })
      ),
    defaultVoice: process.env.CARTESIA_VOICE_ID,
    create: ({ lang, model, voice }) =>
      new CartesiaTTS({
        apiKey: process.env.CARTESIA_API_KEY || '',
        modelId: model || 'sonic-3.6',
        voiceId: voice || process.env.CARTESIA_VOICE_ID || '',
        language: lang.split('-')[0] as CartesiaLanguage,
      }),
  },

  gemini: {
    label: 'Gemini',
    requiredEnv: ['GEMINI_API_KEY'],
    // The 2.5 models send each sentence whole, after a few seconds
    models: listedModels(
      () => GeminiTTS.listModels({ apiKey: process.env.GEMINI_API_KEY || '' }),
      ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts']
    ),
    defaultModel: 'gemini-3.8-flash-tts',
    voices: async (_model, lang) =>
      toVoiceOptions(await GeminiTTS.listVoices({ language: lang })),
    defaultVoice: 'Kore',
    create: ({ model, voice }) =>
      new GeminiTTS({
        apiKey: process.env.GEMINI_API_KEY || '',
        model,
        voice,
      }),
  },

  // The voices of the account and the Gradium catalog, GRADIUM_VOICE_ID picks
  // the default
  gradium: {
    label: 'Gradium',
    requiredEnv: ['GRADIUM_API_KEY'],
    voices: async (_model, lang) =>
      toVoiceOptions(
        await GradiumTTS.listVoices({
          apiKey: process.env.GRADIUM_API_KEY || '',
          language: lang,
        })
      ),
    defaultVoice: process.env.GRADIUM_VOICE_ID || 'Bla6SbVMczYnOhfK',
    create: ({ voice }) =>
      new GradiumTTS({
        apiKey: process.env.GRADIUM_API_KEY || '',
        voiceId: voice || process.env.GRADIUM_VOICE_ID || 'Bla6SbVMczYnOhfK',
      }),
  },

  // Voxtral 3 voices read every supported language, so the select offers
  // them all whatever the language of the call
  mistral: {
    label: 'Mistral',
    requiredEnv: ['MISTRAL_API_KEY'],
    models: listedModels(
      () => MistralTTS.listModels({ apiKey: process.env.MISTRAL_API_KEY || '' }),
      ['voxtral-mini-tts-3-0']
    ),
    defaultModel: 'voxtral-mini-tts-3-0',
    voices: async (_model, lang) =>
      toVoiceOptions(
        await MistralTTS.listVoices({
          apiKey: process.env.MISTRAL_API_KEY || '',
          language: lang,
        })
      ),
    defaultVoice: 'voice_3150',
    create: ({ model, voice }) =>
      new MistralTTS({
        apiKey: process.env.MISTRAL_API_KEY || '',
        model,
        voiceId: voice,
      }),
  },

  // The Realtime API reads each sentence sooner, the speech endpoint has
  // three more voices
  openai: {
    label: 'OpenAI',
    requiredEnv: ['OPENAI_API_KEY'],
    models: listedModels(
      () => OpenaiTTS.listModels({ apiKey: process.env.OPENAI_API_KEY || '' }),
      ['gpt-realtime-2.1-mini', 'gpt-4o-mini-tts']
    ),
    defaultModel: 'gpt-realtime-2.1-mini',
    voices: async (model, lang) =>
      toVoiceOptions(await OpenaiTTS.listVoices({ model, language: lang })),
    defaultVoice: 'marin',
    create: ({ model, voice }) =>
      new OpenaiTTS({
        apiKey: process.env.OPENAI_API_KEY || '',
        model,
        voice,
      }),
  },

  // Local, English only: kokoro-js phonemizes every input as English
  kokoro: {
    label: 'Kokoro',
    description: 'English only',
    local: true,
    voices: () =>
      KOKORO_VOICE_IDS.map((id) => ({
        id,
        label: id,
        language: id.startsWith('b') ? 'en-GB' : 'en-US',
      })),
    defaultVoice: 'af_heart',
    create: ({ voice }) => new KokoroTTS({ voice }),
  },

  // Local, many languages, needs the piper binary and the voice files
  piper: {
    label: 'Piper',
    local: true,
    isAvailable: () => listPiperVoices().length > 0,
    voices: listPiperVoices,
    create: ({ voice }) =>
      new PiperTTS({
        modelPath: path.join(PIPER_VOICES_DIR, voice || ''),
        binaryPath: process.env.PIPER_BINARY,
      }),
  },

  // Local, English only, needs the weights extracted next to the demo
  pocket: {
    label: 'Pocket TTS',
    description: 'English only, clones a voice',
    local: true,
    isAvailable: () => existsSync(POCKET_MODEL_DIR),
    voices: () =>
      Object.keys(BUNDLED_VOICES).map((id) => ({
        id,
        label: id,
        language: 'en-US',
      })),
    defaultVoice: 'bria',
    create: ({ voice }) => new PocketTTS({ modelDir: POCKET_MODEL_DIR, voice }),
  },

  // Local, downloads its model and voices from Hugging Face on first use
  phonon: {
    label: 'Phonon',
    description: 'Gradium, on-device',
    local: true,
    voices: listPhononVoices,
    defaultVoice: 'Easton',
    create: ({ lang, voice }) =>
      new PhononTTS({
        model: getPhononModel(voice),
        voice,
        // The model decides which languages sound right, the language of the
        // call only decides how numbers and symbols are read
        language: lang,
      }),
  },

  // Local, ten languages, needs the mlx-audio server running next to the demo
  qwen: {
    label: 'Qwen3-TTS',
    description: 'Ten languages, needs an mlx-audio server',
    local: true,
    isAvailable: isQwenServerUp,
    // Every speaker reads the ten languages, so the select offers them all
    // whatever the language of the call
    voices: () =>
      Object.entries(QWEN_SPEAKERS).map(([id, origin]) => ({
        id,
        label: `${id} (${origin})`,
      })),
    defaultVoice: 'Ryan',
    create: ({ lang, voice }) =>
      new Qwen3TTS({
        url: QWEN_URL,
        model: process.env.QWEN_MODEL,
        voice,
        // The package reads the locale of the call, fr-FR included
        language: lang,
      }),
  },

  fallback: {
    label: 'Fallback',
    description: 'ElevenLabs, then Cartesia',
    requiredEnv: [
      'ELEVENLABS_API_KEY',
      'ELEVENLABS_VOICE_ID',
      'CARTESIA_API_KEY',
      'CARTESIA_VOICE_ID',
    ],
    create: (context) =>
      new FallbackTTS({
        factories: [
          // Each one keeps its own default model, the selected one belongs to
          // the provider the client picked
          () =>
            text2speech.elevenlabs.create({
              ...context,
              model: text2speech.elevenlabs.defaultModel,
              voice: undefined,
            }),
          () =>
            text2speech.cartesia.create({
              ...context,
              model: text2speech.cartesia.defaultModel,
              voice: undefined,
            }),
        ],
      }),
  },
}

export default text2speech

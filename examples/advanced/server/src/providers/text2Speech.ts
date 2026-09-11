import { CartesiaLanguage, CartesiaTTS } from '@micdrop/cartesia'
import { ElevenLabsTTS, ElevenLabsTTSOptions } from '@micdrop/elevenlabs'
import { GradiumTTS } from '@micdrop/gradium'
import { KOKORO_VOICE_IDS, KokoroTTS } from '@micdrop/kokoro'
import { OpenaiTTS } from '@micdrop/openai'
import { PiperTTS } from '@micdrop/piper'
import { BUNDLED_VOICES, PocketTTS } from '@micdrop/pocket-tts'
import { QWEN_SPEAKERS, Qwen3TTS } from '@micdrop/qwen-tts'
import { FallbackTTS, MockTTS, TTS } from '@micdrop/server'
import { existsSync, readdirSync } from 'fs'
import path from 'path'
import { ModelOption, ProviderRegistry } from './types'

// Where the Pocket TTS archive was extracted, see the README of
// @micdrop/pocket-tts
const POCKET_MODEL_DIR =
  process.env.POCKET_MODEL_DIR ||
  path.join(__dirname, '../../models/sherpa-onnx-pocket-tts-int8-2026-01-26')

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
function listPiperVoices(): ModelOption[] {
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

  // The voice comes from the environment, so the select offers the models,
  // from the quickest to answer to the one speaking the most languages
  elevenlabs: {
    label: 'ElevenLabs',
    requiredEnv: ['ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID'],
    models: [
      { id: 'eleven_flash_v2_5', label: 'eleven_flash_v2_5' },
      { id: 'eleven_turbo_v2_5', label: 'eleven_turbo_v2_5' },
      { id: 'eleven_multilingual_v2', label: 'eleven_multilingual_v2' },
    ],
    defaultModel: 'eleven_flash_v2_5',
    create: ({ model }) =>
      new ElevenLabsTTS({
        apiKey: process.env.ELEVENLABS_API_KEY || '',
        voiceId: process.env.ELEVENLABS_VOICE_ID || '',
        modelId: model as ElevenLabsTTSOptions['modelId'],
      }),
  },

  cartesia: {
    label: 'Cartesia',
    requiredEnv: ['CARTESIA_API_KEY', 'CARTESIA_VOICE_ID'],
    models: [
      { id: 'sonic-turbo', label: 'sonic-turbo' },
      { id: 'sonic-3', label: 'sonic-3' },
      { id: 'sonic-2', label: 'sonic-2' },
    ],
    defaultModel: 'sonic-turbo',
    create: ({ lang, model }) =>
      new CartesiaTTS({
        apiKey: process.env.CARTESIA_API_KEY || '',
        modelId: model || 'sonic-turbo',
        voiceId: process.env.CARTESIA_VOICE_ID || '',
        language: lang.split('-')[0] as CartesiaLanguage,
      }),
  },

  gradium: {
    label: 'Gradium',
    requiredEnv: ['GRADIUM_API_KEY', 'GRADIUM_VOICE_ID'],
    create: () =>
      new GradiumTTS({
        apiKey: process.env.GRADIUM_API_KEY || '',
        voiceId: process.env.GRADIUM_VOICE_ID || '',
      }),
  },

  openai: {
    label: 'OpenAI',
    requiredEnv: ['OPENAI_API_KEY'],
    models: [
      { id: 'alloy', label: 'alloy' },
      { id: 'ash', label: 'ash' },
      { id: 'ballad', label: 'ballad' },
      { id: 'coral', label: 'coral' },
      { id: 'echo', label: 'echo' },
      { id: 'sage', label: 'sage' },
      { id: 'shimmer', label: 'shimmer' },
      { id: 'verse', label: 'verse' },
    ],
    defaultModel: 'alloy',
    create: ({ model }) =>
      new OpenaiTTS({
        apiKey: process.env.OPENAI_API_KEY || '',
        model: 'gpt-4o-mini-tts-2025-12-15',
        voice: model,
      }),
  },

  // Local, English only: kokoro-js phonemizes every input as English
  kokoro: {
    label: 'Kokoro',
    description: 'English only',
    local: true,
    models: KOKORO_VOICE_IDS.map((id) => ({
      id,
      label: id,
      language: id.startsWith('b') ? 'en-GB' : 'en-US',
    })),
    defaultModel: 'af_heart',
    create: ({ model }) => new KokoroTTS({ voice: model }),
  },

  // Local, many languages, needs the piper binary and the voice files
  piper: {
    label: 'Piper',
    local: true,
    isAvailable: () => listPiperVoices().length > 0,
    models: listPiperVoices,
    create: ({ model }) =>
      new PiperTTS({
        modelPath: path.join(PIPER_VOICES_DIR, model || ''),
        binaryPath: process.env.PIPER_BINARY,
      }),
  },

  // Local, English only, needs the weights extracted next to the demo
  pocket: {
    label: 'Pocket TTS',
    description: 'English only, clones a voice',
    local: true,
    isAvailable: () => existsSync(POCKET_MODEL_DIR),
    models: Object.keys(BUNDLED_VOICES).map((id) => ({
      id,
      label: id,
      language: 'en-US',
    })),
    defaultModel: 'bria',
    create: ({ model }) =>
      new PocketTTS({ modelDir: POCKET_MODEL_DIR, voice: model }),
  },

  // Local, ten languages, needs the mlx-audio server running next to the demo
  qwen: {
    label: 'Qwen3-TTS',
    description: 'Ten languages, needs an mlx-audio server',
    local: true,
    isAvailable: isQwenServerUp,
    // Every speaker reads the ten languages, so the select offers them all
    // whatever the language of the call
    models: Object.entries(QWEN_SPEAKERS).map(([id, origin]) => ({
      id,
      label: `${id} (${origin})`,
    })),
    defaultModel: 'Ryan',
    create: ({ lang, model }) =>
      new Qwen3TTS({
        url: QWEN_URL,
        model: process.env.QWEN_MODEL,
        voice: model,
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
            }),
          () =>
            text2speech.cartesia.create({
              ...context,
              model: text2speech.cartesia.defaultModel,
            }),
        ],
      }),
  },
}

export default text2speech

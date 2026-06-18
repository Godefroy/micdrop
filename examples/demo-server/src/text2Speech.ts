import { CartesiaTTS } from '@micdrop/cartesia'
import { ElevenLabsTTS } from '@micdrop/elevenlabs'
import { GradiumTTS } from '@micdrop/gradium'
import { OpenaiTTS } from '@micdrop/openai'
import { FallbackTTS, MockTTS } from '@micdrop/server'
import path from 'path'

const text2speech = {
  // Mock
  mock: () =>
    new MockTTS([
      path.join(__dirname, '../../demo-client/public/chunk-1.wav'),
      path.join(__dirname, '../../demo-client/public/chunk-2.wav'),
    ]),

  // ElevenLabs
  elevenlabs: () =>
    new ElevenLabsTTS({
      apiKey: process.env.ELEVENLABS_API_KEY || '',
      voiceId: process.env.ELEVENLABS_VOICE_ID || '',
      modelId: 'eleven_flash_v2_5',
    }),

  // Cartesia
  cartesia: () =>
    new CartesiaTTS({
      apiKey: process.env.CARTESIA_API_KEY || '',
      modelId: 'sonic-turbo',
      voiceId: process.env.CARTESIA_VOICE_ID || '',
      language: 'fr',
    }),

  // Gradium
  gradium: () =>
    new GradiumTTS({
      apiKey: process.env.GRADIUM_API_KEY || '',
      voiceId: process.env.GRADIUM_VOICE_ID || '',
    }),

  // OpenAI
  openai: () =>
    new OpenaiTTS({
      apiKey: process.env.OPENAI_API_KEY || '',
      model: 'gpt-4o-mini-tts-2025-12-15',
      voice: 'alloy',
    }),

  // Fallback
  fallback: () =>
    new FallbackTTS({
      factories: [text2speech.elevenlabs, text2speech.cartesia],
    }),
}

export default text2speech

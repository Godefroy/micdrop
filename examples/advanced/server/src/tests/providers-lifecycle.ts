import * as dotenv from 'dotenv'
dotenv.config({ quiet: true })

import { CartesiaTTS } from '@micdrop/cartesia'
import { ElevenLabsTTS } from '@micdrop/elevenlabs'
import { GladiaSTT } from '@micdrop/gladia'
import { GradiumSTT, GradiumTTS } from '@micdrop/gradium'
import { MistralSTT } from '@micdrop/mistral'
import { OpenaiSTT } from '@micdrop/openai'
import { spawnSync } from 'child_process'

// Checks how every WebSocket provider handles the edges of a connection:
// npx tsx server/src/tests/providers-lifecycle.ts [provider] [scenario]
//
// - timeout: the connection times out while the socket is still connecting,
//   which used to crash the process, until the provider gives up
// - destroy: the provider is destroyed while it connects, and must not open
//   a connection afterwards
//
// Each case runs in its own process, so a crash fails that case alone.

interface Options {
  connectionTimeout?: number
  retryDelay?: number
  maxRetry?: number
}

const env = (name: string) => process.env[name] || ''

const providers: Record<string, (options: Options) => any> = {
  'elevenlabs-flash': (options) =>
    new ElevenLabsTTS({
      apiKey: env('ELEVENLABS_API_KEY'),
      voiceId: env('ELEVENLABS_VOICE_ID'),
      modelId: 'eleven_flash_v2_5',
      ...options,
    }),
  'elevenlabs-v4': (options) =>
    new ElevenLabsTTS({
      apiKey: env('ELEVENLABS_API_KEY'),
      voiceId: env('ELEVENLABS_VOICE_ID'),
      modelId: 'eleven_v4_turbo',
      ...options,
    }),
  cartesia: (options) =>
    new CartesiaTTS({
      apiKey: env('CARTESIA_API_KEY'),
      voiceId: env('CARTESIA_VOICE_ID'),
      modelId: 'sonic-3.6',
      ...options,
    }),
  gladia: (options) =>
    new GladiaSTT({ apiKey: env('GLADIA_API_KEY'), ...options }),
  'gradium-stt': (options) =>
    new GradiumSTT({ apiKey: env('GRADIUM_API_KEY'), ...options }),
  'gradium-tts': (options) =>
    new GradiumTTS({
      apiKey: env('GRADIUM_API_KEY'),
      voiceId: env('GRADIUM_VOICE_ID'),
      ...options,
    }),
  mistral: (options) =>
    new MistralSTT({ apiKey: env('MISTRAL_API_KEY'), ...options }),
  openai: (options) =>
    new OpenaiSTT({ apiKey: env('OPENAI_API_KEY'), ...options }),
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const scenarios: Record<string, (provider: string) => Promise<string>> = {
  async timeout(provider) {
    const start = Date.now()
    const instance = providers[provider]({
      connectionTimeout: 1,
      retryDelay: 100,
      maxRetry: 2,
    })
    const failed = new Promise<string>((resolve) =>
      instance.on('Failed', () =>
        resolve(`gave up after ${Date.now() - start}ms, no crash`)
      )
    )
    const result = await Promise.race([
      failed,
      sleep(6000).then(() => 'did not give up within 6s'),
    ])
    instance.destroy()
    return result
  },

  async destroy(provider) {
    const logs: string[] = []
    const instance = providers[provider]({})
    instance.logger = {
      log: (...message: any[]) => logs.push(message.join(' ')),
    }
    await sleep(20)
    instance.destroy()
    const destroyedAt = logs.length
    await sleep(8000)
    const after = logs
      .slice(destroyedAt)
      .filter((line) => /Reconnecting|Connection opened/.test(line))
    return after.length
      ? `connected again after destroy(): ${after.join(' | ')}`
      : 'nothing after destroy()'
  },
}

async function run(provider: string, scenario: string) {
  const result = await scenarios[scenario](provider)
  console.log(`${provider} ${scenario}: ${result}`)
  process.exit(0)
}

const [provider, scenario] = process.argv.slice(2)
if (provider && scenario) {
  run(provider, scenario)
} else {
  for (const name of Object.keys(providers)) {
    if (provider && provider !== name) continue
    for (const test of Object.keys(scenarios)) {
      const child = spawnSync('npx', ['tsx', __filename, name, test], {
        encoding: 'utf-8',
      })
      const line = child.stdout
        .split('\n')
        .find((text) => text.startsWith(`${name} ${test}:`))
      console.log(
        line ??
          `${name} ${test}: CRASHED (exit ${child.status}) ${
            child.stderr.split('\n').find((text) => /Error/.test(text)) ?? ''
          }`
      )
    }
  }
}

import * as dotenv from 'dotenv'
dotenv.config()

import { ElevenLabsModelId, ElevenLabsTTS } from '@micdrop/elevenlabs'
import { Logger } from '@micdrop/server'
import fs from 'fs'
import { Readable } from 'stream'
import { createTextStream } from './utils/createLongTextStream'

// Plays the situations a call puts the TTS in, against the real API:
// npx tsx server/src/tests/elevenlabs-tts-scenarios.ts [model] [scenario]

const modelId = (process.argv[2] || 'eleven_v4_turbo') as ElevenLabsModelId
const only = process.argv[3]
const verbose = process.env.VERBOSE === '1'

const BYTES_PER_SECOND = 32000 // PCM 16 bits, 16 kHz, mono
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const seconds = (bytes: number) => (bytes / BYTES_PER_SECOND).toFixed(2) + 's'

function createTTS(voiceId = process.env.ELEVENLABS_VOICE_ID || '') {
  const tts = new ElevenLabsTTS({
    apiKey: process.env.ELEVENLABS_API_KEY || '',
    voiceId,
    modelId,
  })
  if (verbose) tts.logger = new Logger('ElevenLabsTTS')
  return tts
}

/** Counts the audio of a TTS, from a point in time */
function listen(tts: ElevenLabsTTS) {
  const state = { bytes: 0, chunks: 0, first: 0, start: Date.now() }
  tts.on('Audio', (chunk) => {
    if (!state.first) state.first = Date.now() - state.start
    state.bytes += chunk.length
    state.chunks++
  })
  return {
    state,
    reset() {
      state.bytes = 0
      state.chunks = 0
      state.first = 0
      state.start = Date.now()
    },
  }
}

function wav(pcm: Buffer) {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(16000, 24)
  header.writeUInt32LE(BYTES_PER_SECOND, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

const scenarios: Record<string, () => Promise<string>> = {
  // An answer streamed word by word, saved to listen to it
  async save() {
    const tts = createTTS()
    const chunks: Buffer[] = []
    tts.on('Audio', (chunk) => chunks.push(chunk))
    const { state, reset } = listen(tts)
    await sleep(500) // Connection
    reset()
    tts.speak(
      createTextStream(
        "Hi there! [laughs] I'm so glad you called. What can I do for you today?",
        30
      )
    )
    await sleep(6000)
    tts.destroy()
    fs.writeFileSync(`elevenlabs-${modelId}.wav`, wav(Buffer.concat(chunks)))
    return `first audio ${state.first}ms, ${seconds(state.bytes)} saved to elevenlabs-${modelId}.wav`
  },

  // The user interrupts: nothing more is heard, and the next answer plays
  async cancel() {
    const tts = createTTS()
    const { state, reset } = listen(tts)
    await sleep(500)
    reset()
    tts.speak(createTextStream(undefined, 20))
    while (state.chunks < 3) await sleep(10)
    tts.cancel()
    const before = state.bytes
    await sleep(2000)
    const leaked = state.bytes - before
    reset()
    tts.speak(Readable.from(['Sure, ', 'I stopped. ', 'Go on.']))
    await sleep(3000)
    tts.destroy()
    return `after cancel: ${seconds(leaked)} leaked (expect 0s), next answer: first audio ${state.first}ms, ${seconds(state.bytes)}`
  },

  // A second speak() takes over from the first without cancel()
  async supersede() {
    const tts = createTTS()
    const { state, reset } = listen(tts)
    await sleep(500)
    tts.speak(createTextStream(undefined, 20))
    while (state.chunks < 3) await sleep(10)
    reset()
    tts.speak(Readable.from(['Second answer, ', 'short. ']))
    await sleep(3000)
    tts.destroy()
    return `after takeover: first audio ${state.first}ms, ${seconds(state.bytes)} (expect about 1s, not the rest of the first answer)`
  },

  // A stream without a word keeps the sentence being spoken
  async empty() {
    const tts = createTTS()
    const { state } = listen(tts)
    await sleep(500)
    tts.speak(createTextStream(undefined, 20))
    while (state.chunks < 3) await sleep(10)
    tts.speak(Readable.from([]))
    await sleep(6000)
    tts.destroy()
    return `${seconds(state.bytes)} heard in total (expect over 10s, the whole first answer)`
  },

  // Longer than the 20 seconds the server waits before closing
  async idle() {
    const tts = createTTS()
    const { state, reset } = listen(tts)
    await sleep(25000)
    reset()
    tts.speak(Readable.from(['Still here. ', 'Ready when you are.']))
    await sleep(3000)
    tts.destroy()
    return `after 25s idle: first audio ${state.first}ms, ${seconds(state.bytes)}`
  },

  // A voice the server rejects after opening the connection
  async badVoice() {
    const tts = createTTS('notARealVoiceId123')
    const start = Date.now()
    const failed = new Promise<string>((resolve) =>
      tts.on('Failed', (texts) =>
        resolve(
          `Failed after ${Date.now() - start}ms with ${JSON.stringify(texts)}`
        )
      )
    )
    const result = await Promise.race([
      failed,
      sleep(15000).then(() => 'never failed (expect Failed after 3 retries)'),
    ])
    tts.destroy()
    return result
  },
}

async function main() {
  for (const [name, scenario] of Object.entries(scenarios)) {
    if (only && only !== name) continue
    try {
      console.log(`${modelId} ${name}: ${await scenario()}`)
    } catch (error) {
      console.log(`${modelId} ${name}: ERROR`, error)
    }
  }
  process.exit(0)
}

main()

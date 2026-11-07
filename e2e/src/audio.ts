import { OpenaiTTS } from '@micdrop/openai'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { key } from './env.js'
import { sleep } from './wait.js'

/** Rate of the audio the Micdrop client sends and plays, PCM 16 bits mono */
export const SAMPLE_RATE = 16_000
export const BYTES_PER_SECOND = SAMPLE_RATE * 2
/** The client sends its audio in chunks of 100 ms */
const CHUNK_BYTES = BYTES_PER_SECOND / 10

const CACHE_DIR = fileURLToPath(new URL('../.cache', import.meta.url))

/** Sentences spoken to the speech to text and realtime models */
export const SPEECH = {
  fox: 'The quick brown fox jumps over the lazy dog.',
  paris: 'Paris is the capital of France.',
  pizza: 'I would like to order a large pizza.',
  question: 'What is the capital of France? Answer in one word.',
} as const

/**
 * Speech for a sentence, synthesized once by OpenAI and kept in `e2e/.cache`,
 * so the tests that only hear it cost nothing after the first run
 */
export async function speech(text: string): Promise<Buffer> {
  const hash = createHash('sha1').update(text).digest('hex').slice(0, 12)
  const path = `${CACHE_DIR}/${hash}.pcm`
  if (existsSync(path)) return readFileSync(path)

  const tts = new OpenaiTTS({ apiKey: key('OPENAI_API_KEY'), voice: 'marin' })
  const chunks: Buffer[] = []
  tts.on('Audio', (chunk) => chunks.push(chunk))
  const textStream = new PassThrough()
  tts.speak(textStream)
  textStream.end(text)

  // Done once the voice stays quiet for a moment
  let length = 0
  const start = Date.now()
  while (Date.now() - start < 30_000) {
    await sleep(1500)
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    if (total > 0 && total === length) break
    length = total
  }
  tts.destroy()
  const audio = Buffer.concat(chunks)
  if (audio.length === 0) throw new Error(`No speech synthesized for "${text}"`)

  mkdirSync(CACHE_DIR, { recursive: true })
  writeFileSync(path, audio)
  return audio
}

/** Whether the speech fixtures can be made, or were made before */
export function canSpeak(): boolean {
  return !!key('OPENAI_API_KEY') || existsSync(CACHE_DIR)
}

/**
 * Sends speech the way the client does: in chunks of 100 ms, in real time
 * @param end - Ends the stream after the last chunk, as the end of the turn
 */
export async function speakInto(
  stream: PassThrough,
  audio: Buffer,
  { end = true } = {}
): Promise<void> {
  for (let offset = 0; offset < audio.length; offset += CHUNK_BYTES) {
    stream.write(audio.subarray(offset, offset + CHUNK_BYTES))
    await sleep(100)
  }
  if (end) stream.end()
}

/**
 * Writes audio to `e2e/.cache/audio/<name>.wav` when `E2E_SAVE_AUDIO=1`, to
 * listen to what a voice sounded like
 */
export function saveAudio(name: string, chunks: Buffer[]) {
  if (process.env.E2E_SAVE_AUDIO !== '1') return
  const pcm = Buffer.concat(chunks)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // Mono
  header.writeUInt32LE(SAMPLE_RATE, 24)
  header.writeUInt32LE(BYTES_PER_SECOND, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  const dir = `${CACHE_DIR}/audio`
  mkdirSync(dir, { recursive: true })
  const file = name.replace(/[^\w.-]+/g, '-').toLowerCase()
  writeFileSync(`${dir}/${file}.wav`, Buffer.concat([header, pcm]))
}

/** Counts the audio a TTS or a realtime model emits */
export class AudioMeter {
  public audio: Buffer[] = []
  public bytes = 0
  public chunks = 0
  // When the audio received so far stops playing, heard in real time as the
  // client plays it
  public playedUntil = 0

  constructor(emitter: {
    on(event: 'Audio', listener: (chunk: Buffer) => void): unknown
  }) {
    emitter.on('Audio', (chunk: Buffer) => {
      this.audio.push(chunk)
      this.bytes += chunk.length
      this.chunks++
      const duration = (chunk.length / BYTES_PER_SECOND) * 1000
      this.playedUntil = Math.max(this.playedUntil, Date.now()) + duration
    })
  }

  get seconds(): number {
    return this.bytes / BYTES_PER_SECOND
  }

  /**
   * Waits until audio came, then the listener heard `quiet` ms of silence.
   *
   * A provider that synthesizes sentence by sentence sends the next one while
   * the previous still plays, which is no silence at all.
   */
  async untilQuiet(quiet = 2000, timeout = 30_000): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < timeout) {
      if (this.chunks > 0 && Date.now() - this.playedUntil > quiet) return
      await sleep(100)
    }
    throw new Error(
      `No end of audio after ${timeout} ms (${this.chunks} chunks)`
    )
  }
}

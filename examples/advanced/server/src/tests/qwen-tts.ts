// Qwen3-TTS -> Whisper round trip, in English then in French, with the delay
// before the first audio and the pace of the chunks after it.
//
// Needs an mlx-audio server holding the checkpoint, see the README of
// @micdrop/qwen-tts. QWEN_URL and QWEN_MODEL override its address and the
// checkpoint it loads.
import { Qwen3TTS } from '@micdrop/qwen-tts'
import { WhisperSTT, WhisperSTTOptions } from '@micdrop/whisper'
import { PassThrough } from 'stream'

const URL = process.env.QWEN_URL || 'http://localhost:8000'
const MODEL = process.env.QWEN_MODEL

const CASES = [
  {
    language: 'english',
    whisper: { model: 'base', language: 'en' } as WhisperSTTOptions,
    text: 'Hello, how can I help you today? The weather is fine in Paris.',
  },
  {
    language: 'french',
    whisper: { model: 'french', language: 'fr' } as WhisperSTTOptions,
    text:
      "Bonjour, comment puis-je vous aider aujourd'hui ? " +
      'Il fait beau à Paris cet après-midi.',
  },
]

async function speak(language: string, text: string) {
  const tts = new Qwen3TTS({
    url: URL,
    model: MODEL,
    voice: 'Ryan',
    language,
    warmup: false,
  })
  tts.logger = { log: (...a: any[]) => console.log('[tts]', ...a) } as any

  const audio: Buffer[] = []
  let firstChunkAt = 0
  let lastChunkAt = Date.now()

  const startedAt = Date.now()
  tts.on('Audio', (chunk) => {
    if (!firstChunkAt) firstChunkAt = Date.now()
    lastChunkAt = Date.now()
    audio.push(chunk)
    console.log(
      `chunk ${chunk.length} bytes (${(chunk.length / 2 / 16000).toFixed(2)}s) ` +
        `at ${lastChunkAt - startedAt}ms`
    )
  })
  tts.on('Failed', (texts) => console.error('TTS failed:', texts))

  const textStream = new PassThrough()
  tts.speak(textStream)
  textStream.end(text)

  // The first sentence waits for the checkpoint to be loaded, which the server
  // does on its first request and can take a minute
  const deadline = Date.now() + 180000
  while (!firstChunkAt && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100))
  }
  while (Date.now() - lastChunkAt < 5000) {
    await new Promise((r) => setTimeout(r, 100))
  }

  const pcm = Buffer.concat(audio)
  console.log(
    `first audio after ${firstChunkAt - startedAt}ms, ` +
      `${(pcm.length / 2 / 16000).toFixed(2)}s of audio generated in ` +
      `${lastChunkAt - startedAt}ms`
  )
  tts.destroy()
  return pcm
}

async function transcribe(pcm: Buffer, options: WhisperSTTOptions) {
  const stt = new WhisperSTT({ ...options, warmup: false })
  return new Promise<string>((resolve, reject) => {
    stt.on('Transcript', resolve)
    stt.on('Failed', () => reject(new Error('STT failed')))
    const stream = new PassThrough()
    stt.transcribe(stream)
    for (let i = 0; i < pcm.length; i += 3200) {
      stream.write(pcm.subarray(i, i + 3200))
    }
    stream.end()
  })
}

async function main() {
  for (const { language, whisper, text } of CASES) {
    console.log(`\n--- ${language} ---`)
    const pcm = await speak(language, text)
    if (pcm.length === 0) throw new Error('No audio produced')

    const transcript = await transcribe(pcm, whisper)
    console.log('input :', text)
    console.log('output:', transcript)
  }
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

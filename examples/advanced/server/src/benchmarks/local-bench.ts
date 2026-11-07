import { KokoroTTS } from '@micdrop/kokoro'
import { WhisperSTT } from '@micdrop/whisper'
import { PassThrough } from 'stream'

async function makeAudio(text: string): Promise<Buffer> {
  const tts = new KokoroTTS({ warmup: false })
  const audio: Buffer[] = []
  tts.on('Audio', (c) => audio.push(c))
  const stream = new PassThrough()
  tts.speak(stream)
  stream.end(text)
  let last = Date.now()
  tts.on('Audio', () => (last = Date.now()))
  while (Date.now() - last < 4000) await new Promise((r) => setTimeout(r, 200))
  tts.destroy()
  return Buffer.concat(audio)
}

async function bench(model: any, dtype: any, pcm: Buffer, runs = 3) {
  const t0 = Date.now()
  const stt = new WhisperSTT({ model, dtype, language: 'en', warmup: false })
  const run = () =>
    new Promise<{ ms: number; text: string }>((resolve) => {
      const t = Date.now()
      const stream = new PassThrough()
      const onTranscript = (text: string) => {
        stt.off('Transcript', onTranscript)
        resolve({ ms: Date.now() - t, text })
      }
      stt.on('Transcript', onTranscript)
      stt.transcribe(stream)
      for (let i = 0; i < pcm.length; i += 3200) {
        stream.write(pcm.subarray(i, i + 3200))
      }
      stream.end()
    })
  await run()
  const load = Date.now() - t0
  const times = []
  let text = ''
  for (let i = 0; i < runs; i++) {
    const r = await run()
    times.push(r.ms)
    text = r.text
  }
  stt.destroy()
  return { load, times, text }
}

async function main() {
  const pcm = await makeAudio('I would like to book a table for four people.')
  console.log(`Utterance: ${(pcm.length / 2 / 16000).toFixed(2)}s\n`)

  for (const [model, dtype] of [
    ['tiny', 'fp32'],
    ['base', 'fp32'],
    ['base', 'q8'],
    ['small', 'fp32'],
  ] as const) {
    const r = await bench(model, dtype, pcm)
    const avg = Math.round(r.times.reduce((a, b) => a + b, 0) / r.times.length)
    console.log(
      `${model} ${dtype}: warm ${avg}ms (${r.times.join(', ')}) load ${r.load}ms`
    )
    console.log(`  "${r.text}"`)
  }
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

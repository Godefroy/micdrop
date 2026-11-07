// Compares Whisper checkpoints on French speech that is easy to get wrong:
// proper nouns, numbers, liaisons and homophones.
import { PiperTTS } from '@micdrop/piper'
import { WhisperSTT } from '@micdrop/whisper'
import path from 'path'
import { PassThrough } from 'stream'

const VOICE = path.join(__dirname, '../../voices/fr_FR-siwis-medium.onnx')

const SENTENCES = [
  "Bonjour, j'aimerais réserver une table pour quatre personnes à Aix-en-Provence.",
  'Il fait beau à Paris cet après-midi, vers dix-sept heures trente.',
  "Pouvez-vous m'envoyer la facture par courriel s'il vous plaît ?",
  'Mon collègue Grégoire habite à Rouen depuis quatorze ans.',
  'Ces achats sont chers, mais la chair de ce poisson est fraîche.',
]

const CONFIGS = [
  { model: 'base', dtype: 'q8', label: 'base q8' },
  { model: 'small', dtype: 'q8', label: 'small q8' },
  { model: 'turbo', dtype: 'q8', label: 'turbo q8' },
  {
    model: 'onnx-community/whisper-small-cv11-french-ONNX',
    dtype: 'q8',
    label: 'small-fr q8',
  },
] as const

async function speak(text: string): Promise<Buffer> {
  const tts = new PiperTTS({ modelPath: VOICE })
  const chunks: Buffer[] = []
  tts.on('Audio', (chunk) => chunks.push(chunk))
  await new Promise((r) => setTimeout(r, 2000))
  const stream = new PassThrough()
  tts.speak(stream)
  stream.end(text)
  let last = Date.now()
  tts.on('Audio', () => (last = Date.now()))
  while (Date.now() - last < 2000) await new Promise((r) => setTimeout(r, 100))
  tts.destroy()
  return Buffer.concat(chunks)
}

function transcribeOnce(stt: WhisperSTT, pcm: Buffer) {
  return new Promise<{ ms: number; text: string }>((resolve, reject) => {
    const started = Date.now()
    const onTranscript = (text: string) => {
      stt.off('Transcript', onTranscript)
      resolve({ ms: Date.now() - started, text })
    }
    stt.on('Transcript', onTranscript)
    stt.once('Failed', () => reject(new Error('STT failed')))
    const stream = new PassThrough()
    stt.transcribe(stream)
    for (let i = 0; i < pcm.length; i += 3200) {
      stream.write(pcm.subarray(i, i + 3200))
    }
    stream.end()
  })
}

// Word error rate, ignoring case, accents, punctuation and digit spelling
function normalize(text: string) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function errors(got: string, want: string) {
  const a = normalize(got).split(' ')
  const b = normalize(want).split(' ')
  const d: number[][] = Array.from({ length: b.length + 1 }, (_, i) =>
    Array.from({ length: a.length + 1 }, (_, j) =>
      i === 0 ? j : j === 0 ? i : 0
    )
  )
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      d[i][j] =
        b[i - 1] === a[j - 1]
          ? d[i - 1][j - 1]
          : 1 + Math.min(d[i - 1][j - 1], d[i][j - 1], d[i - 1][j])
    }
  }
  return { edits: d[b.length][a.length], words: b.length }
}

async function main() {
  console.log('Generating French audio with Piper...')
  const clips: Buffer[] = []
  for (const sentence of SENTENCES) clips.push(await speak(sentence))
  const seconds = clips.reduce((n, c) => n + c.length / 2 / 16000, 0)
  console.log(`${clips.length} clips, ${seconds.toFixed(1)}s of speech\n`)

  for (const { model, dtype, label } of CONFIGS) {
    const stt = new WhisperSTT({ model, dtype, language: 'fr', warmup: false })
    await transcribeOnce(stt, clips[0]) // Load and warm up

    let edits = 0
    let words = 0
    const times: number[] = []
    const wrong: string[] = []
    for (let i = 0; i < clips.length; i++) {
      const { ms, text } = await transcribeOnce(stt, clips[i])
      times.push(ms)
      const e = errors(text, SENTENCES[i])
      edits += e.edits
      words += e.words
      if (e.edits > 0) wrong.push(`      "${text}"`)
    }
    const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length)
    console.log(
      `${label.padEnd(10)} ${String(avg).padStart(5)}ms/utterance  ` +
        `${((edits / words) * 100).toFixed(1)}% word errors (${edits}/${words})`
    )
    wrong.forEach((line) => console.log(line))
    stt.destroy()
  }
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

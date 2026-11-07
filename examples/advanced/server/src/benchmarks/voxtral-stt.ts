// Measures Voxtral Mini 3B, the speech to text model of Mistral, running in
// Node through Transformers.js, on the same French sentences as
// whisper-french-bench.ts. Voxtral is an audio capable Ministral 3B, so it is
// two orders of magnitude bigger than a Whisper checkpoint: the question is
// whether the accuracy it buys is worth the latency it costs.
import { PiperTTS } from '@micdrop/piper'
import { pcm16ToFloat32 } from '@micdrop/server'
import { WhisperSTT } from '@micdrop/whisper'
import path from 'path'
import { PassThrough } from 'stream'

const VOICE = path.join(__dirname, '../../voices/fr_FR-siwis-medium.onnx')
// The weights weigh three gigabytes, and the download that Transformers.js
// runs on its own aborts on a file that size. Fetch them once with
//   hf download onnx-community/Voxtral-Mini-3B-2507-ONNX --include "*.json" \
//     "*.jinja" "onnx/*_q4.onnx*" --exclude "*q4f16*" --local-dir <dir>
// and point VOXTRAL_DIR at the folder holding it.
const REPO_ID = 'onnx-community/Voxtral-Mini-3B-2507-ONNX'
const LOCAL_DIR = process.env.VOXTRAL_DIR

const SENTENCES = [
  "Bonjour, j'aimerais réserver une table pour quatre personnes à Aix-en-Provence.",
  'Il fait beau à Paris cet après-midi, vers dix-sept heures trente.',
  'Mon collègue Grégoire habite à Rouen depuis quatorze ans.',
]

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

function transcribeWhisper(stt: WhisperSTT, pcm: Buffer) {
  return new Promise<string>((resolve, reject) => {
    const onTranscript = (text: string) => {
      stt.off('Transcript', onTranscript)
      resolve(text)
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

  console.log('Loading Voxtral...')
  const loadStarted = Date.now()
  const { VoxtralForConditionalGeneration, VoxtralProcessor, env } =
    await import('@huggingface/transformers')
  let modelId = REPO_ID
  if (LOCAL_DIR) {
    env.localModelPath = LOCAL_DIR
    env.allowRemoteModels = false
    modelId = 'Voxtral-Mini-3B-2507-ONNX'
  }
  const processor = await (VoxtralProcessor as any).from_pretrained(modelId)
  const model = await (VoxtralForConditionalGeneration as any).from_pretrained(
    modelId,
    {
      dtype: {
        embed_tokens: 'q4',
        audio_encoder: 'q4',
        decoder_model_merged: 'q4',
      },
      device: 'cpu',
    }
  )
  console.log(`Loaded in ${((Date.now() - loadStarted) / 1000).toFixed(1)}s\n`)

  const conversation = [
    {
      role: 'user',
      content: [
        { type: 'audio' },
        { type: 'text', text: 'lang:fr [TRANSCRIBE]' },
      ],
    },
  ]
  const prompt = processor.apply_chat_template(conversation, {
    tokenize: false,
  })

  const results: {
    label: string
    ms: number[]
    edits: number
    words: number
  }[] = []

  const voxtral = {
    label: 'voxtral q4',
    ms: [] as number[],
    edits: 0,
    words: 0,
  }
  for (let i = 0; i < clips.length; i++) {
    const audio = pcm16ToFloat32(clips[i])
    const started = Date.now()
    const inputs = await processor(prompt, audio)
    const generated = await model.generate({ ...inputs, max_new_tokens: 128 })
    const newTokens = generated.slice(null, [
      inputs.input_ids.dims.at(-1),
      null,
    ])
    const text: string = processor
      .batch_decode(newTokens, { skip_special_tokens: true })[0]
      .trim()
    // The first pass pays the graph warm up, it is reported apart below
    const ms = Date.now() - started
    voxtral.ms.push(ms)
    const e = errors(text, SENTENCES[i])
    voxtral.edits += e.edits
    voxtral.words += e.words
    console.log(`  [${ms}ms] "${text}"`)
  }
  results.push(voxtral)

  for (const checkpoint of ['base', 'french'] as const) {
    const stt = new WhisperSTT({
      model: checkpoint,
      language: 'fr',
      warmup: false,
    })
    await transcribeWhisper(stt, clips[0]) // Load and warm up
    const entry = {
      label: `whisper ${checkpoint}`,
      ms: [] as number[],
      edits: 0,
      words: 0,
    }
    for (let i = 0; i < clips.length; i++) {
      const started = Date.now()
      const text = await transcribeWhisper(stt, clips[i])
      entry.ms.push(Date.now() - started)
      const e = errors(text, SENTENCES[i])
      entry.edits += e.edits
      entry.words += e.words
      console.log(`  [${entry.ms[i]}ms] "${text}"`)
    }
    stt.destroy()
    results.push(entry)
  }

  console.log()
  for (const { label, ms, edits, words } of results) {
    const warm = ms.slice(1)
    const avg = Math.round(warm.reduce((a, b) => a + b, 0) / warm.length)
    console.log(
      `${label.padEnd(14)} first ${String(ms[0]).padStart(6)}ms, ` +
        `then ${String(avg).padStart(6)}ms/utterance, ` +
        `${((edits / words) * 100).toFixed(1)}% word errors (${edits}/${words})`
    )
  }
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

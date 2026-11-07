// Measures whether an execution provider other than the CPU speeds up the
// Whisper encoder on this machine.
//
// The encoder is the fixed cost of a transcription, so it is what a GPU would
// have to make faster to be worth using. Providers that are not available on
// the platform fail to create a session, which the script reports rather than
// treating as an error.
//
// Pass the path of an encoder from the Transformers.js cache:
//   MODEL=.../onnx/encoder_model_quantized.onnx npx ts-node-dev ... onnx-device-bench.ts
import * as ort from 'onnxruntime-node'

// Whisper reads a fixed window of thirty seconds, 80 mel bins by 3000 frames
const INPUT_DIMS = [1, 80, 3000]

const PROVIDERS: Array<{ label: string; providers: any[] }> = [
  { label: 'cpu', providers: ['cpu'] },
  { label: 'coreml (macOS)', providers: ['coreml'] },
  {
    label: 'coreml MLProgram',
    providers: [{ name: 'coreml', ModelFormat: 'MLProgram' }],
  },
  { label: 'cuda (Linux, NVIDIA)', providers: ['cuda'] },
  { label: 'dml (Windows)', providers: ['dml'] },
]

async function bench(model: string, providers: any[], runs = 5) {
  const loadStarted = Date.now()
  const session = await ort.InferenceSession.create(model, {
    executionProviders: providers,
  })
  const load = Date.now() - loadStarted

  const data = new Float32Array(INPUT_DIMS[1] * INPUT_DIMS[2])
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 0.1
  const feeds = {
    input_features: new ort.Tensor('float32', data, INPUT_DIMS),
  }

  await session.run(feeds) // Warm up, the first run allocates
  const times: number[] = []
  for (let i = 0; i < runs; i++) {
    const started = Date.now()
    await session.run(feeds)
    times.push(Date.now() - started)
  }
  return {
    load,
    average: Math.round(times.reduce((a, b) => a + b, 0) / times.length),
    times,
  }
}

async function main() {
  const model = process.env.MODEL
  if (!model) {
    console.error(
      'Set MODEL to an encoder_model*.onnx from the Transformers.js cache, ' +
        'under node_modules/.../@huggingface/transformers/.cache'
    )
    process.exit(1)
  }

  for (const { label, providers } of PROVIDERS) {
    try {
      const r = await bench(model, providers)
      console.log(
        `${label.padEnd(22)} load ${String(r.load).padStart(6)}ms  ` +
          `encoder ${String(r.average).padStart(5)}ms  (${r.times.join(', ')})`
      )
    } catch (error: any) {
      console.log(
        `${label.padEnd(22)} unavailable: ${error.message.split('\n')[0]}`
      )
    }
  }
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

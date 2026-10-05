import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { initSync, Model } from 'phonon-tts/raw'
import { parentPort, workerData } from 'worker_threads'
import type { WorkerData, WorkerReply, WorkerRequest } from './protocol'

/**
 * Runs the Phonon WebAssembly module off the main thread.
 *
 * The module generates one 80 ms frame per step and computes it without
 * yielding, so running it on the event loop of the server would hold every
 * other call for the length of a sentence. Here the frames are produced one
 * at a time, with a turn of this thread's event loop between two of them,
 * which is where a cancel coming from the main thread is heard.
 */

interface Job {
  id: number
  voicePath: string
  text: string
  temperature: number
  seed: number
}

const port = parentPort!
const data = workerData as WorkerData
const require = createRequire(import.meta.url)

const queue: Job[] = []
const cancelled = new Set<number>()
// Voices are registered once, the model keeps their state by index
const voiceIndexes = new Map<string, number>()
let model: Model | undefined
let running = false

function reply(message: WorkerReply, transfer?: ArrayBuffer[]) {
  port.postMessage(message, transfer)
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

/**
 * The package ships the module built with Relaxed SIMD, and a build without
 * it for engines that cannot compile that one.
 */
function initModule() {
  try {
    initSync({
      module: readFileSync(
        require.resolve('phonon-tts/wasm/phonon_tts_bg.wasm')
      ),
    })
  } catch {
    initSync({
      module: readFileSync(
        require.resolve('phonon-tts/wasm/phonon_tts_simd_bg.wasm')
      ),
    })
  }
}

async function load() {
  initModule()
  model = await Model.load(
    readFileSync(data.weights),
    readFileSync(data.tokenizer),
    readFileSync(data.config),
    data.quant,
    data.language,
    data.rewrites,
    data.conditions,
    'cpu'
  )
  reply({
    type: 'ready',
    sampleRate: model.sample_rate(),
    languages: model.languages(),
  })
}

function getVoiceIndex(model: Model, path: string): number {
  let index = voiceIndexes.get(path)
  if (index === undefined) {
    index = model.add_voice(readFileSync(path))
    voiceIndexes.set(path, index)
  }
  return index
}

async function generate(model: Model, job: Job) {
  model.start_generation(
    getVoiceIndex(model, job.voicePath),
    job.text,
    job.temperature,
    BigInt(job.seed)
  )
  try {
    // Long sentences are split into chunks, each one prompted in turn
    while (!cancelled.has(job.id) && model.next_chunk() !== undefined) {
      while (!cancelled.has(job.id)) {
        const samples: Float32Array | undefined = await model.generation_step()
        if (!samples) break
        reply({ type: 'audio', id: job.id, samples }, [
          samples.buffer as ArrayBuffer,
        ])
        await nextTurn()
      }
    }
  } finally {
    model.stop_generation()
  }
}

async function drain() {
  if (running || !model) return
  running = true
  while (queue.length) {
    const job = queue.shift()!
    if (!cancelled.has(job.id)) {
      try {
        await generate(model, job)
      } catch (error) {
        reply({ type: 'failed', id: job.id, message: String(error) })
      }
    }
    cancelled.delete(job.id)
    reply({ type: 'done', id: job.id })
  }
  running = false
}

port.on('message', (message: WorkerRequest) => {
  switch (message.type) {
    case 'generate':
      queue.push(message)
      drain()
      break
    case 'cancel':
      cancelled.add(message.id)
      break
  }
})

load()
  .then(drain)
  .catch((error) => reply({ type: 'loadFailed', message: String(error) }))

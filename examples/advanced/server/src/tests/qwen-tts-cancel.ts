// Cancels Qwen3-TTS mid-sentence and checks that its audio stops there.
//
// The sentence is generated on the mlx-audio server and streamed back as it
// comes, so an interruption has to close the connection between two chunks
// rather than wait for the sentence to be finished. The server sees the
// disconnection and drops the generation, which frees it for the next answer.
import { Logger } from '@micdrop/server'
import { Qwen3TTS } from '@micdrop/qwen-tts'
import { createTextStream } from './utils/createLongTextStream'

const tts = new Qwen3TTS({
  url: process.env.QWEN_URL || 'http://localhost:8000',
  model: process.env.QWEN_MODEL,
  warmup: false,
})
tts.logger = new Logger('Qwen3TTS')

const COUNT_STOP = 3
let i = 0
let cancelledAt = 0

tts.on('Audio', (chunk) => {
  i++
  console.log(`Chunk received #${i} (${chunk.length} bytes)`)
  if (cancelledAt) {
    console.error(`Chunk after cancel, ${Date.now() - cancelledAt}ms later`)
  }
  if (i === COUNT_STOP) {
    console.log('Enough chunks received, cancelling tts')
    cancelledAt = Date.now()
    tts.cancel()
  }
})

tts.on('Failed', (texts) => {
  console.log('TTS failed', texts)
  tts.destroy()
})

tts.speak(createTextStream())

// Anything still generating would report itself in the meantime
setTimeout(() => {
  if (!cancelledAt) {
    console.error(`Only ${i} chunks came in, nothing was cancelled`)
    tts.destroy()
    process.exit(1)
  }
  console.log(`No chunk for ${Date.now() - cancelledAt}ms after the cancel`)
  tts.destroy()
  process.exit(0)
}, 5000)

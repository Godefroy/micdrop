// Cancels Phonon mid-sentence and checks that its audio stops there.
//
// The generation runs on a worker thread and hands its frames over as they
// come, so an interruption has to reach it between two frames rather than
// wait for the sentence to be finished.
import { PhononTTS } from '@micdrop/phonon'
import { Logger } from '@micdrop/server'
import path from 'path'
import { createTextStream } from './utils/createLongTextStream'

const MODEL_DIR =
  process.env.MODEL_DIR ||
  path.join(__dirname, '../../models/phonon-7e71a02d.200')

const tts = new PhononTTS({ modelDir: MODEL_DIR, warmup: false })
tts.logger = new Logger('PhononTTS')

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
  console.log(`No chunk for ${Date.now() - cancelledAt}ms after the cancel`)
  tts.destroy()
}, 5000)

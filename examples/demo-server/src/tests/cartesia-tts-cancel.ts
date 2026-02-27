import * as dotenv from 'dotenv'
dotenv.config()

import { CartesiaTTS } from '@micdrop/cartesia'
import { Logger } from '@micdrop/server'
import { createTextStream } from './utils/createLongTextStream'

const textStream = createTextStream()

const tts = new CartesiaTTS({
  apiKey: process.env.CARTESIA_API_KEY || '',
  modelId: 'sonic-turbo',
  voiceId: process.env.CARTESIA_VOICE_ID || '',
})
tts.logger = new Logger('CartesiaTTS')

tts.speak(textStream)

const COUNT_STOP = 3
let i = 0
tts.on('Audio', (chunk) => {
  i++
  console.log(`Chunk received #${i} (${chunk.length} bytes)`)
  if (i === COUNT_STOP) {
    console.log('Enough chunks received, cancelling tts')
    tts.cancel()
    tts.destroy()
  }
})

tts.on('Failed', (texts) => {
  console.log('TTS failed', texts)
  tts.destroy()
})

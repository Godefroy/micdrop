import * as dotenv from 'dotenv'
dotenv.config()

import { MistralTTS } from '@micdrop/mistral'
import { Logger } from '@micdrop/server'
import { createTextStream } from './utils/createLongTextStream'

const textStream = createTextStream()

const tts = new MistralTTS({
  apiKey: process.env.MISTRAL_API_KEY || '',
})
tts.logger = new Logger('MistralTTS')

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

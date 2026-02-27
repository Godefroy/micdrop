import * as dotenv from 'dotenv'
dotenv.config()

import { GradiumTTS } from '@micdrop/gradium'
import { Logger } from '@micdrop/server'
import { createTextStream } from './utils/createLongTextStream'

const textStream = createTextStream()

const tts = new GradiumTTS({
  apiKey: process.env.GRADIUM_API_KEY || '',
  voiceId: process.env.GRADIUM_VOICE_ID || '',
})
tts.logger = new Logger('GradiumTTS')

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

import * as dotenv from 'dotenv'
dotenv.config()

import { GradiumTTS } from '@micdrop/gradium'
import { Logger } from '@micdrop/server'
import fs from 'fs'
import { createTextStream } from './utils/createLongTextStream'

const textStream = createTextStream(
  `Hello, I'm Micdrop! What can I do for you today?`
)

const tts = new GradiumTTS({
  apiKey: process.env.GRADIUM_API_KEY || '',
  voiceId: process.env.GRADIUM_VOICE_ID || '',
})
tts.logger = new Logger('GradiumTTS')

tts.speak(textStream)

let i = 0
tts.on('Audio', (chunk) => {
  i++
  console.log(`Chunk received and saved #${i} (${chunk.length} bytes)`)
  fs.writeFileSync(`chunk-${i}.pcm`, chunk)
})

tts.on('Failed', (texts) => {
  console.log('TTS failed', texts)
  tts.destroy()
})

textStream.on('end', () => {
  setTimeout(() => {
    console.log('Text stream ended, destroying tts')
    tts.destroy()
  }, 5000)
})

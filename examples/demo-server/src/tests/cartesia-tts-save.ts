import * as dotenv from 'dotenv'
dotenv.config()

import { CartesiaTTS } from '@micdrop/cartesia'
import { Logger } from '@micdrop/server'
import fs from 'fs'
import { createTextStream } from './utils/createLongTextStream'

const textStream = createTextStream(
  `Hello, I'm Micdrop! What can I do for you today?`
)

const tts = new CartesiaTTS({
  apiKey: process.env.CARTESIA_API_KEY || '',
  modelId: 'sonic-turbo',
  voiceId: process.env.CARTESIA_VOICE_ID || '',
})
tts.logger = new Logger('CartesiaTTS')

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

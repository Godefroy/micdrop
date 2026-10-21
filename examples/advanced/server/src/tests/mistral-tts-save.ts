import * as dotenv from 'dotenv'
dotenv.config()

import { MistralTTS } from '@micdrop/mistral'
import { Logger } from '@micdrop/server'
import fs from 'fs'
import { createTextStream } from './utils/createLongTextStream'

const textStream = createTextStream(
  `Bonjour, je suis Micdrop ! Que puis-je faire pour vous aujourd'hui ? Je peux répondre à vos questions.`
)

const tts = new MistralTTS({
  apiKey: process.env.MISTRAL_API_KEY || '',
  voiceId: 'voice_592', // Marie, French
})
tts.logger = new Logger('MistralTTS')

const start = Date.now()
tts.speak(textStream)

const chunks: Buffer[] = []
tts.on('Audio', (chunk) => {
  if (chunks.length === 0) console.log(`First audio after ${Date.now() - start} ms`)
  chunks.push(chunk)
  console.log(`Chunk received #${chunks.length} (${chunk.length} bytes)`)
})

tts.on('Failed', (texts) => {
  console.log('TTS failed', texts)
  tts.destroy()
})

textStream.on('end', () => {
  setTimeout(() => {
    const audio = Buffer.concat(chunks)
    // PCM16 at 16 kHz: 32 bytes per millisecond
    console.log(`Audio: ${audio.length / 32000} s, saved to mistral-tts.pcm`)
    fs.writeFileSync('mistral-tts.pcm', audio)
    tts.destroy()
  }, 5000)
})

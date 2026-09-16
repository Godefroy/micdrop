import * as dotenv from 'dotenv'
dotenv.config()

import { GeminiLive } from '@micdrop/gemini'
import { Logger } from '@micdrop/server'
import { PassThrough } from 'stream'
import { streamAudioChunks } from './utils/streamAudioChunks'

const realtime = new GeminiLive({
  apiKey: process.env.GEMINI_API_KEY || '',
  systemPrompt: 'You are a voice assistant. Answer in one short sentence.',
})
realtime.logger = new Logger('GeminiLive')

let audioBytes = 0
realtime.on('Audio', (chunk) => (audioBytes += chunk.length))

// The turn is recorded first, then the answer
realtime.on('Message', (message) => {
  console.log('Message:', message)
  if (message.role !== 'assistant') return
  console.log(`Answer audio: ${audioBytes} bytes`)
  realtime.destroy()
})

// Send the recorded speech as one turn, closed when the audio ends
const audioStream = new PassThrough()
realtime.startTurn(audioStream)
audioStream.on('end', () => realtime.endTurn())
streamAudioChunks(audioStream)

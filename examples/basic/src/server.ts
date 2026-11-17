// Server side of the call.
// It listens on a WebSocket and lets Micdrop orchestrate the three AI steps:
// transcribe what the user says, answer with an LLM, speak the answer out loud.
// https://micdrop.dev/docs/server

import { OpenaiAgent, OpenaiSTT, OpenaiTTS } from '@micdrop/openai'
import { MicdropServer } from '@micdrop/server'
import { WebSocketServer } from 'ws'

const PORT = 8085
const apiKey = process.env.OPENAI_API_KEY || ''

const server = new WebSocketServer({ port: PORT })

server.on('connection', (socket) => {
  // One call per connection.
  // https://micdrop.dev/docs/server/installation
  new MicdropServer(socket, {
    // Spoken right away, so the user hears a voice before the LLM has run.
    // https://micdrop.dev/docs/server/first-message
    firstMessage: 'Hi! What can I do for you?',

    // The brain, an LLM that writes the answers.
    // https://micdrop.dev/docs/agents/openai
    agent: new OpenaiAgent({
      apiKey,
      systemPrompt:
        'You are a friendly assistant. Your answers are spoken out loud, so keep them short and conversational.',
    }),

    // The ears, speech to text.
    stt: new OpenaiSTT({ apiKey, language: 'en' }),

    // The mouth, text to speech.
    tts: new OpenaiTTS({ apiKey, voice: 'alloy' }),
  })
})

console.log(`Micdrop server listening on ws://localhost:${PORT}`)

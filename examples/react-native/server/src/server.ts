// Server side of the call, the same one a browser would talk to.
// It listens on a WebSocket and lets Micdrop orchestrate the three AI steps:
// transcribe what the user says, answer with an LLM, speak the answer out loud.
// https://micdrop.dev/docs/server

import { OpenaiAgent, OpenaiSTT, OpenaiTTS } from '@micdrop/openai'
import { MicdropServer } from '@micdrop/server'
import { WebSocketServer } from 'ws'

const PORT = 8087
const apiKey = process.env.OPENAI_API_KEY || ''

// Listening on every interface, so a phone on the same Wi-Fi can reach it
const server = new WebSocketServer({ port: PORT, host: '0.0.0.0' })

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
        'You are a friendly assistant on a phone. Your answers are spoken out loud, so keep them short and conversational.',
    }),

    // The ears, speech to text.
    stt: new OpenaiSTT({ apiKey, language: 'en' }),

    // The conversation shows the answer as the agent writes it, ahead of the
    // voice that reads it out.
    // https://micdrop.dev/docs/server/partial-messages
    partialMessages: true,

    // The mouth, text to speech.
    tts: new OpenaiTTS({ apiKey, voice: 'alloy' }),
  })
})

console.log(`Micdrop server listening on ws://0.0.0.0:${PORT}`)

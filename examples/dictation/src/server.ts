// Server side of the dictation.
// There is no agent and no text to speech here: the call only transcribes, so
// the microphone goes to the speech to text and the words come back as
// messages.
// https://micdrop.dev/docs/server/dictation

import { OpenaiSTT } from '@micdrop/openai'
import { handleError, MicdropServer, waitForParams } from '@micdrop/server'
import { WebSocketServer } from 'ws'
import { LANGUAGES, toSupportedLanguage } from './languages'

const PORT = 8088
const apiKey = process.env.OPENAI_API_KEY || ''

const server = new WebSocketServer({ port: PORT })

server.on('connection', async (socket) => {
  try {
    // The page picks the language, and transcription is more accurate for it
    // https://micdrop.dev/docs/server/auth-and-parameters
    const { language } = await waitForParams(socket, validateParams)
    console.log(`Dictating in ${language}`)

    // One call per connection, with the ears only.
    // https://micdrop.dev/docs/server/installation
    new MicdropServer(socket, {
      // The ears, and the only AI component this call needs.
      // https://micdrop.dev/docs/speech-to-text/openai
      stt: new OpenaiSTT({ apiKey, language }),
    })
  } catch (error) {
    handleError(socket, error)
  }
})

function validateParams(params: any): { language: string } {
  const language = params?.language
  if (!LANGUAGES.some((item) => item.code === language)) {
    throw new Error(`Unsupported language: ${language}`)
  }
  return { language: toSupportedLanguage(language) }
}

console.log(`Micdrop dictation server listening on ws://localhost:${PORT}`)

// Browser side of the dictation.
// The call carries no voice back, so the page has one job: put what the user
// says into the text area, sentence after sentence.
// https://micdrop.dev/docs/client

import { Micdrop, MicdropState } from '@micdrop/web'
import { LANGUAGES, toSupportedLanguage } from './languages'
import '@micdrop/web/silero'

// Address of the server started by src/server.ts
const SERVER_URL = 'ws://localhost:8088'

const micButton = document.getElementById('mic') as HTMLButtonElement
const statusText = document.getElementById('status') as HTMLParagraphElement
const languageSelect = document.getElementById('language') as HTMLSelectElement
const transcript = document.getElementById('transcript') as HTMLTextAreaElement
const copyButton = document.getElementById('copy') as HTMLButtonElement

// The picker opens on the language of the browser, since that is the one the
// user is most likely about to speak
for (const language of LANGUAGES) {
  const option = document.createElement('option')
  option.value = language.code
  option.textContent = language.label
  languageSelect.append(option)
}
languageSelect.value = toSupportedLanguage(navigator.language)

// One button for the whole session. Starting it asks for the microphone and
// opens the WebSocket.
// https://micdrop.dev/docs/client/start-stop-call
micButton.addEventListener('click', async () => {
  if (Micdrop.isStarted || Micdrop.isStarting) {
    await Micdrop.stop()
  } else {
    await start()
  }
})

// The server sets up the transcription for one language when the call opens, so
// changing it takes a new call.
// https://micdrop.dev/docs/server/auth-and-parameters
languageSelect.addEventListener('change', async () => {
  if (!Micdrop.isStarted && !Micdrop.isStarting) return
  await Micdrop.stop()
  await start()
})

async function start() {
  try {
    await Micdrop.start({
      url: SERVER_URL,
      vad: ['volume', 'silero'],
      params: { language: languageSelect.value },
    })
  } catch {
    // Already reported by the Error listener below
  }
}

// Everything about the call arrives through this one event: who is speaking,
// and whether the microphone is up.
// https://micdrop.dev/docs/client/call-state
Micdrop.on('StateChange', (state) => {
  const running = state.isStarted || state.isStarting
  micButton.textContent = running ? '⏹' : '🎤'
  micButton.setAttribute(
    'aria-label',
    running ? 'Stop dictation' : 'Start dictation'
  )
  micButton.classList.toggle('recording', state.isUserSpeaking)
  statusText.textContent = getStatus(state)
})

// Sentences settle one at a time and land at the end of the text area, where
// they can be edited like any other text.
// https://micdrop.dev/docs/server/dictation
Micdrop.on('Message', (message) => {
  if (message.role !== 'user') return
  transcript.value += (transcript.value ? ' ' : '') + message.content
  transcript.scrollTop = transcript.scrollHeight
})

// Microphone refused, server unreachable, and so on.
// https://micdrop.dev/docs/client/error-handling
Micdrop.on('Error', (error) => {
  statusText.textContent = `Error: ${error.code}`
})

copyButton.addEventListener('click', async () => {
  await navigator.clipboard.writeText(transcript.value)
  copyButton.textContent = 'Copied'
  setTimeout(() => (copyButton.textContent = 'Copy'), 1500)
})

function getStatus(state: MicdropState) {
  if (state.isStarting) return 'Opening the microphone'
  if (!state.isStarted) return 'Press the microphone and dictate'
  if (state.isUserSpeaking) return 'Listening'
  return 'Waiting for you to speak'
}

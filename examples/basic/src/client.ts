// Browser side of the call.
// Micdrop takes care of the microphone, the voice activity detection, the
// speaker and the WebSocket, so this file only wires a button and some text.
// https://micdrop.dev/docs/client

import { Micdrop, MicdropState } from '@micdrop/web'

// Address of the server started by src/server.ts
const SERVER_URL = 'ws://localhost:8085'

const callButton = document.getElementById('call') as HTMLButtonElement
const statusText = document.getElementById('status') as HTMLParagraphElement
const conversationList = document.getElementById(
  'conversation'
) as HTMLUListElement

// A single button for the whole call. Starting it asks for the microphone,
// opens the WebSocket and begins listening.
// https://micdrop.dev/docs/client/start-stop-call
callButton.addEventListener('click', async () => {
  try {
    if (Micdrop.isStarted || Micdrop.isStarting) {
      await Micdrop.stop()
    } else {
      await Micdrop.start({ url: SERVER_URL })
    }
  } catch {
    // Already reported by the Error listener below
  }
})

// Everything that happens during the call arrives through this one event:
// who is speaking, whether the assistant is thinking, and the new messages.
// https://micdrop.dev/docs/client/call-state
Micdrop.on('StateChange', (state) => {
  callButton.textContent =
    state.isStarted || state.isStarting ? 'Stop call' : 'Start call'
  statusText.textContent = getStatus(state)
  showConversation(state)
})

// The assistant can hang up on its own when the conversation is over.
// https://micdrop.dev/docs/server/auto-end-call
Micdrop.on('EndCall', () => Micdrop.stopAfterAnswer())

// Microphone refused, server unreachable, and so on.
// https://micdrop.dev/docs/client/error-handling
Micdrop.on('Error', (error) => {
  statusText.textContent = `Error: ${error.code}`
})

function getStatus(state: MicdropState) {
  if (state.isStarting) return 'Starting the call'
  if (!state.isStarted) return 'Ready'
  if (state.isUserSpeaking) return 'Listening to you'
  if (state.isAssistantSpeaking) return 'Assistant is speaking'
  if (state.isProcessing) return 'Assistant is thinking'
  return 'Waiting for you to speak'
}

// The conversation is kept up to date by the client, ready to be displayed.
// https://micdrop.dev/docs/client/display-conversation-messages
function showConversation(state: MicdropState) {
  conversationList.replaceChildren()
  for (const item of state.conversation) {
    if (item.role !== 'user' && item.role !== 'assistant') continue
    const line = document.createElement('li')
    line.textContent = `${item.role === 'user' ? '🧑' : '🤖'} ${item.content}`
    conversationList.append(line)
  }
}

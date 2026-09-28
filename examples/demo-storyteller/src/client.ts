// Browser side of the storyteller demo.
// Micdrop takes care of the microphone, the voice activity detection, the
// speaker and the WebSocket. The page picks the voice model and shows the
// audio tags of each answer apart from its words.
// https://micdrop.dev/docs/client

import { Micdrop, MicdropState } from '@micdrop/web'
import { VOICE_MODELS } from './models'

// Address of the server started by src/server.ts
const SERVER_URL = 'ws://localhost:8099'

const callButton = document.getElementById('call') as HTMLButtonElement
const modelSelect = document.getElementById('model') as HTMLSelectElement
const statusText = document.getElementById('status') as HTMLParagraphElement
const conversationList = document.getElementById(
  'conversation'
) as HTMLUListElement

for (const model of VOICE_MODELS) {
  const option = document.createElement('option')
  option.value = model.id
  option.textContent = model.label
  modelSelect.append(option)
}

// One button for the whole call. Starting it asks for the microphone, opens
// the WebSocket and begins listening.
// https://micdrop.dev/docs/client/start-stop-call
callButton.addEventListener('click', async () => {
  if (Micdrop.isStarted || Micdrop.isStarting) {
    await Micdrop.stop()
  } else {
    await start()
  }
})

// The server sets up the voice when the call opens, so changing it takes a
// new call
modelSelect.addEventListener('change', async () => {
  if (!Micdrop.isStarted && !Micdrop.isStarting) return
  await Micdrop.stop()
  await start()
})

async function start() {
  try {
    await Micdrop.start({
      url: SERVER_URL,
      params: { model: modelSelect.value },
    })
  } catch {
    // Already reported by the Error listener below
  }
}

// Who is speaking, whether the storyteller is thinking, and the messages.
// https://micdrop.dev/docs/client/call-state
Micdrop.on('StateChange', (state) => {
  callButton.textContent =
    state.isStarted || state.isStarting ? 'Leave the fire' : 'Sit by the fire'
  statusText.textContent = getStatus(state)
  showConversation(state)
})

// The storyteller can end the call when the traveler says goodbye.
// https://micdrop.dev/docs/server/auto-end-call
Micdrop.on('EndCall', () => Micdrop.stop())

// Microphone refused, server unreachable, and so on.
// https://micdrop.dev/docs/client/error-handling
Micdrop.on('Error', (error) => {
  statusText.textContent = `Error: ${error.code}`
})

function getStatus(state: MicdropState) {
  if (state.isStarting) return 'Walking to the fire'
  if (!state.isStarted) return 'The fire is burning'
  if (state.isUserSpeaking) return 'Ember is listening'
  if (state.isAssistantSpeaking) return 'Ember is telling'
  if (state.isProcessing) return 'Ember is thinking'
  return 'Your turn'
}

// The answer being written comes last, so its tags show up before they are
// heard.
// https://micdrop.dev/docs/client/display-conversation-messages
function showConversation(state: MicdropState) {
  const lines: { role: string; content: string }[] = []
  for (const item of state.conversation) {
    if (item.role !== 'user' && item.role !== 'assistant') continue
    lines.push({ role: item.role, content: item.content })
  }
  if (state.partialAssistantMessage) {
    lines.push({ role: 'assistant', content: state.partialAssistantMessage })
  }

  conversationList.replaceChildren()
  for (const line of lines) {
    const item = document.createElement('li')
    item.className = line.role
    item.append(...renderTags(line.content))
    conversationList.append(item)
  }
}

// An audio tag is a direction for the voice, drawn apart from the words
function renderTags(text: string): Node[] {
  return text
    .split(/(\[[^\]]+\])/)
    .filter(Boolean)
    .map((part) => {
      if (!/^\[[^\]]+\]$/.test(part)) return document.createTextNode(part)
      const tag = document.createElement('span')
      tag.className = 'tag'
      tag.textContent = part.slice(1, -1)
      return tag
    })
}

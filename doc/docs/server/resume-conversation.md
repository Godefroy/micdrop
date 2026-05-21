# Resume a Conversation

Pick up a saved conversation where the user left off. Useful when the WebSocket drops mid-call, the user closes the tab, or the session is intentionally paused and resumed later.

The idea is to rehydrate the `Agent` with the messages it had at the end of the previous call, before plugging in the live listeners and starting the new `MicdropServer`. The LLM then has the same context it had before, and the assistant can continue from where it stopped.

## Replay Messages Before Wiring Listeners

Use `agent.addMessage(role, content)` (or `addUserMessage` / `addAssistantMessage`) to rebuild the conversation. Do this **before** attaching the `Message` listener you use to persist new messages, so replayed history isn't saved a second time.

```typescript
import { MicdropServer } from '@micdrop/server'

// Fetch what you stored on the previous call
const history = await db.conversations.findBy({ sessionId })

const agent = new OpenaiAgent({
  apiKey: process.env.OPENAI_API_KEY,
  systemPrompt: 'You are a helpful assistant',
})

// 1. Rehydrate first — addMessage emits "Message", so do it before subscribing
for (const message of history) {
  agent.addMessage(message.role, message.content)
}

// 2. Then subscribe to persist only new messages
agent.on('Message', async (message) => {
  await db.conversations.create({
    sessionId,
    role: message.role,
    content: message.content,
  })
})

new MicdropServer(socket, { agent, stt, tts })
```

See [Save Messages](./save-messages) for the matching save-side pattern.

## Skip the First Message on Resumption

When resuming, you usually don't want the assistant to greet the user again. Omit both `firstMessage` and `generateFirstMessage`, and instead inject a short system instruction telling the model to pick up the thread:

```typescript
const isResuming = history.length > 0

for (const message of history) {
  agent.addMessage(message.role, message.content)
}

if (isResuming) {
  agent.addMessage(
    'system',
    'The conversation was interrupted. Continue naturally from the last exchange without greeting the user again.'
  )
}

new MicdropServer(socket, {
  agent,
  stt,
  tts,
  // Only generate a greeting when there is no history
  ...(isResuming ? {} : { generateFirstMessage: true }),
})
```

See [First Message](./first-message) for the non-resumption flow.

## Re-speak the Last Assistant Question

If the last stored message is from the assistant, the user probably never heard the end of it (the socket dropped while it was speaking, or they reloaded the page right after). Re-speak it through the TTS so the user knows what they were just asked, without asking the agent to regenerate anything:

```typescript
const server = new MicdropServer(socket, { agent, stt, tts })

const last = history[history.length - 1]
if (last?.role === 'assistant') {
  // Replays the existing assistant message via TTS. The agent's conversation
  // already contains it (added above), so no new "Message" event fires and no
  // duplicate row is created.
  server.speak(last.content)
}
```

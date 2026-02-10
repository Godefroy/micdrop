# Save Messages

Capture and store conversation messages by listening to the Agent "Message" event for analytics, logging, and conversation history.

## Basic Message Logging

Listen for conversation messages:

```typescript
const agent = new OpenaiAgent({
  apiKey: process.env.OPENAI_API_KEY,
  systemPrompt: 'You are a helpful assistant',
})

// Listen for all conversation messages
agent.on('Message', (message) => {
  console.log('New message:', {
    role: message.role, // 'user' or 'assistant'
    content: message.content, // The message text
    timestamp: new Date().toISOString(),
  })
})

new MicdropServer(socket, { agent, tts })
```

## Save Messages to Database

Store messages in your database:

```typescript
import { db } from './database' // Your database connection

agent.on('Message', async (message) => {
  try {
    await db.conversations.create({
      userId: currentUserId,
      sessionId: currentSessionId,
      role: message.role,
      content: message.content,
      timestamp: new Date(),
    })
  } catch (error) {
    console.error('Failed to save message:', error)
  }
})
```

## Save Conversation when Call ends

Save the complete conversation when the call ends by listening to the `End` event:

```typescript
import { MicdropServer } from '@micdrop/server'

const server = new MicdropServer(socket, {
  agent,
  stt,
  tts,
})

server.on('End', async (call) => {
  // Save conversation
  await db.conversations.create({
    userId: currentUserId,
    sessionId: currentSessionId,
    messages: call.conversation,
    endedAt: new Date(),
    duration: call.duration,
    totalMessages: call.conversation.length,
  })
})
```

> ⚠️ **Warning**: In case of server errors or crashes, the conversation may not be saved using this approach. For critical applications, it's recommended to save messages individually as they arrive (see [Save to Database](#save-to-database) section above) to ensure no messages are lost.

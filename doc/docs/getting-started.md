# Getting Started

Get up and running with [Micdrop](/) to build real-time voice conversations with AI agents.

## Quick Setup

### Client (Browser)

Install the browser package and start capturing voice input:

```bash
npm install @micdrop/client
```

If you're using React, you can also install [@micdrop/react](./client/react-hooks) package to get a ready-to-use React hooks.

```typescript
import { Micdrop } from '@micdrop/client'

// Start a voice conversation
Micdrop.start({
  url: 'ws://localhost:8081',
})

// Listen for events
Micdrop.on('StateChange', (state) => {
  console.log('Conversation:', state.conversation)
  console.log('isAssistantSpeaking:', state.isAssistantSpeaking)
})

Micdrop.on('EndCall', () => {
  console.log('Call ended by assistant')
})
```

### Server (Node.js)

Install the server package and set up AI integrations:

```bash
npm install @micdrop/server @micdrop/openai @micdrop/gladia @micdrop/elevenlabs
```

This example uses OpenAI, Gladia and ElevenLabs. You can use other providers with a [provided or custom integrations](../ai-integration).

```typescript
import { MicdropServer } from '@micdrop/server'
import { OpenaiAgent } from '@micdrop/openai'
import { GladiaSTT } from '@micdrop/gladia'
import { ElevenLabsTTS } from '@micdrop/elevenlabs'
import { WebSocketServer } from 'ws'

const wss = new WebSocketServer({ port: 8081 })

wss.on('connection', (socket) => {
  // Handle voice conversation
  new MicdropServer(socket, {
    firstMessage: 'How can I help you today?',

    agent: new OpenaiAgent({
      apiKey: process.env.OPENAI_API_KEY,
      systemPrompt: 'You are a helpful assistant',
    }),

    stt: new GladiaSTT({
      apiKey: process.env.GLADIA_API_KEY,
    }),

    tts: new ElevenLabsTTS({
      apiKey: process.env.ELEVENLABS_API_KEY,
      voiceId: process.env.ELEVENLABS_VOICE_ID,
    }),
  })
})
```

Don't forget to set the API keys in the environment variables.

## Demos

See Micdrop in action:

- **Main Demo**
  - **[Client](https://github.com/Godefroy/micdrop/tree/main/examples/demo-client)** - React application with full UI
  - **[Server](https://github.com/Godefroy/micdrop/tree/main/examples/demo-server)** - Server setup with fastify
- **[Form Demo](https://github.com/Godefroy/micdrop-form-demo)** - A demo app showcasing Micdrop's capabilities for voice-assisted form filling using OpenAI and tool calling.

## Setup Documentation MCP

To vibe code your Micdrop implementation faster with Cursor, Claude Code or any other agent, [install Context7 MCP](https://github.com/upstash/context7).

Once the MCP is installed, you can prompt like this:

```
create a turbo monorepo in current folder with a client and a server in a new /apps folder:
- server: a simple fastify server with Typescript that implements a micdrop server (use context7)
- client: a simple React webapp with micdrop client. show play/stop/pause buttons and conversation, no other UI. make it beautiful and futuristic.
```

## Troubleshooting

**Microphone not working?**

- Check browser permissions for microphone access
- Ensure you're serving over HTTPS in production

**WebSocket connection fails?**

- Verify the server is running on the correct port
- Check firewall settings

**AI responses not working?**

- Verify all API keys are set correctly
- Check the server console for error messages

# Server (Node.js)

**Micdrop server** orchestrates voice conversations by integrating AI agents, speech-to-text, and text-to-speech services with WebSocket communication.

## Installation

```bash
npm install @micdrop/server
```

See [Installation](./installation) for more details.

## Quick Example

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

## Demo

Check out [demo server](https://github.com/Godefroy/micdrop/tree/main/examples/demo-server), it shows:

- Setting up a Fastify server with WebSocket support
- Configuring the MicdropServer with custom handlers
- Basic authentication flow
- Example agent, speech-to-text and text-to-speech implementations
- Error handling patterns

## Core Components

- **MicdropServer** - Main server class for conversation orchestration
- **[Agent](../ai-integration/custom-integrations/custom-agent)** - AI agent base class and implementations
- **[STT](../ai-integration/custom-integrations/custom-stt)** - Speech-to-text base class and implementations
- **[TTS](../ai-integration/custom-integrations/custom-tts)** - Text-to-speech base class and implementations

## Framework Integrations

- **[Installation](./installation)** - Basic Node.js setup
- **[With Fastify](./with-fastify)** - Fastify framework integration
- **[With NestJS](./with-nestjs)** - NestJS framework integration

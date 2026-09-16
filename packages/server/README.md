# 🖐️🎤 Micdrop: Real-Time Voice Conversations with AI

[Micdrop website](https://micdrop.dev) | [Documentation](https://micdrop.dev/docs/server) | [Basic example](../../examples/basic) | [Demo](../../examples/advanced)

Micdrop is a set of open source Typescript packages to build real-time voice conversations with AI agents. It handles all the complexities on the browser and server side (microphone, speaker, VAD, network communication, etc) and provides ready-to-use implementations for various AI providers.

# @micdrop/server

The Node.js server implementation of [Micdrop](https://micdrop.dev).

For browser implementation, see [@micdrop/client](https://micdrop.dev/docs/client).

## Features

- 🤖 AI agents integration
- 🎙️ Speech-to-text and text-to-speech integration
- 🔊 Advanced audio processing:
  - Streaming input and output
  - Audio conversion
  - Interruptions handling
- 💬 Conversation state management
- 🌐 WebSocket-based audio streaming

## Installation

```bash
npm install @micdrop/server
```

## Quick Start

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

## Agent / STT / TTS

Micdrop server has 3 main components:

- `Agent` - AI agent using LLM, optional
- `STT` - Speech-to-text
- `TTS` - Text-to-speech, optional

A server given a speech to text alone transcribes and stays quiet, which is all
a dictation tool needs. One given an agent and no voice answers in writing. See
[dictation and text-only calls](https://micdrop.dev/docs/server/dictation).

A `realtime` model hears the user and answers with its own voice, in place of
all three. See [realtime models](https://micdrop.dev/docs/server/realtime).

### Available implementations

Micdrop provides ready-to-use implementations for the following AI providers:

- [@micdrop/openai](https://micdrop.dev/docs/ai-integration/provided-integrations/openai)
- [@micdrop/gemini](https://micdrop.dev/docs/ai-integration/provided-integrations/gemini)
- [@micdrop/ai-sdk](https://micdrop.dev/docs/ai-integration/provided-integrations/ai-sdk)
- [@micdrop/elevenlabs](https://micdrop.dev/docs/ai-integration/provided-integrations/elevenlabs)
- [@micdrop/cartesia](https://micdrop.dev/docs/ai-integration/provided-integrations/cartesia)
- [@micdrop/mistral](https://micdrop.dev/docs/ai-integration/provided-integrations/mistral)
- [@micdrop/gladia](https://micdrop.dev/docs/ai-integration/provided-integrations/gladia)

### Custom implementations

You can use provided abstractions to write your own implementation:

- **[Agent](https://micdrop.dev/docs/ai-integration/custom-integrations/custom-agent)** - Abstract class for answer generation
- **[STT](https://micdrop.dev/docs/ai-integration/custom-integrations/custom-stt)** - Abstract class for speech-to-text
- **[TTS](https://micdrop.dev/docs/ai-integration/custom-integrations/custom-tts)** - Abstract class for text-to-speech
- **[Realtime](https://micdrop.dev/docs/server/realtime#writing-your-own)** - Abstract class for speech-to-speech models

## Documentation

Read full [documentation of the Micdrop server](https://micdrop.dev/docs/server) on the [website](https://micdrop.dev).

## License

MIT

## Author

Originally developed for [Raconte.ai](https://www.raconte.ai), created and open sourced by [Godefroy de Compreignac](https://github.com/Godefroy)

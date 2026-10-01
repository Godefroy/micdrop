# @micdrop/cartesia

[Micdrop website](https://micdrop.dev) | [Documentation](https://micdrop.dev/docs/ai-integration/provided-integrations/cartesia)

Cartesia implementation for [@micdrop/server](https://micdrop.dev/docs/server).

## Installation

```bash
npm install @micdrop/cartesia
```

## Cartesia TTS (Text-to-Speech)

### Usage with MicdropServer

```typescript
import { CartesiaTTS } from '@micdrop/cartesia'
import { MicdropServer } from '@micdrop/server'

const tts = new CartesiaTTS({
  apiKey: process.env.CARTESIA_API_KEY || '',
  modelId: 'sonic-3.6', // Cartesia model ID
  voiceId: 'a0e99841-438c-4a64-b679-ae501e7d6091', // Voice ID
  language: 'en', // Optional: specify language
  generationConfig: { speed: 1.1 }, // Optional: speed, volume and emotion
})

// Use with MicdropServer
new MicdropServer(socket, {
  tts,
  // ... other options
})
```

### Usage without MicdropServer

```typescript
import { CartesiaTTS } from '@micdrop/cartesia'
import { Readable } from 'stream'

const tts = new CartesiaTTS({
  apiKey: process.env.CARTESIA_API_KEY || '',
  modelId: 'sonic-3.6',
  voiceId: 'a0e99841-438c-4a64-b679-ae501e7d6091',
})

// Audio is raw PCM, 16 bits, 16 kHz, mono
tts.on('Audio', (chunk) => console.log('Audio:', chunk.length, 'bytes'))
tts.on('Failed', (texts) => console.error('Failed:', texts))

tts.speak(Readable.from(['Hello! ', 'What can I do for you?']))
```

### Events

| Event    | Payload    | Description                                                              |
| -------- | ---------- | ------------------------------------------------------------------------ |
| `Audio`  | `Buffer`   | A chunk of audio, PCM 16 bits, 16 kHz, mono, ready to be played.         |
| `Failed` | `string[]` | Synthesis gave up after its retries, with the text that stayed unspoken. |

See the [TTS interface](https://micdrop.dev/docs/ai-integration/custom-integrations/custom-tts) for the full contract.

## Documentation

Read full [documentation of the Cartesia integration for Micdrop](https://micdrop.dev/docs/ai-integration/provided-integrations/cartesia) on the [website](https://micdrop.dev).

## License

MIT

## Author

Originally developed for [Raconte.ai](https://www.raconte.ai), created and open sourced by [Godefroy de Compreignac](https://github.com/Godefroy)

# @micdrop/elevenlabs

[Micdrop website](https://micdrop.dev) | [Documentation](https://micdrop.dev/docs/ai-integration/provided-integrations/elevenlabs)

`@micdrop/elevenlabs` streams ElevenLabs text to speech for [@micdrop/server](https://micdrop.dev/docs/server). It works with Eleven v4 Turbo, Eleven v4, Eleven v3, Flash v2.5, Turbo v2.5 and Multilingual v2, and picks the WebSocket each model needs.

## Installation

```bash
npm install @micdrop/elevenlabs
```

## ElevenLabs TTS (Text-to-Speech)

### Usage with MicdropServer

```typescript
import { ElevenLabsTTS } from '@micdrop/elevenlabs'
import { MicdropServer } from '@micdrop/server'

const tts = new ElevenLabsTTS({
  apiKey: process.env.ELEVENLABS_API_KEY || '',
  voiceId: '21m00Tcm4TlvDq8ikWAM', // ElevenLabs voice ID
  modelId: 'eleven_v4_turbo', // Optional: model to use
  language: 'en', // Optional: language code
  voiceSettings: {
    stability: 0.5,
  },
})

// Use with MicdropServer
new MicdropServer(socket, {
  tts,
  // ... other options
})
```

### Usage without MicdropServer

```typescript
import { ElevenLabsTTS } from '@micdrop/elevenlabs'
import { Readable } from 'stream'

const tts = new ElevenLabsTTS({
  apiKey: process.env.ELEVENLABS_API_KEY || '',
  voiceId: '21m00Tcm4TlvDq8ikWAM',
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
| `Failed` | `string[]` | The text left unspoken when `ElevenLabsTTS` gives up after its retries.  |

See the [TTS interface](https://micdrop.dev/docs/ai-integration/custom-integrations/custom-tts) for the full contract.

### Models

| Model                                                          | WebSocket        | Audio tags |
| -------------------------------------------------------------- | ---------------- | ---------- |
| `eleven_v4_turbo`, `eleven_v4`, `eleven_v3_conversational`, `eleven_v3` | Text to Dialogue | Performed  |
| `eleven_flash_v2_5`, `eleven_multilingual_v2`, `eleven_turbo_v2_5`      | Text to Speech   | Read out   |

`eleven_turbo_v2_5` is the default. An LLM can write audio tags such as `[whispers]` or `[laughs]` into its answers. Eleven v3 and v4 perform them, while the other models read them out loud.

`voiceSettings` takes the `VoiceSettings` type of the ElevenLabs SDK, with its keys in camel case. Eleven v3 and v4 only read its `stability`.

ElevenLabs counts each open connection to the Text to Dialogue WebSocket as one of the [dialogue sessions your plan allows at once](https://elevenlabs.io/docs/overview/models#text-to-dialogue-concurrency), so each call holds one session from start to end.

## Documentation

Read full [documentation of the ElevenLabs integration for Micdrop](https://micdrop.dev/docs/ai-integration/provided-integrations/elevenlabs) on the [website](https://micdrop.dev).

## License

MIT

## Author

Originally developed for [Raconte.ai](https://www.raconte.ai), created and open sourced by [Godefroy de Compreignac](https://github.com/Godefroy)

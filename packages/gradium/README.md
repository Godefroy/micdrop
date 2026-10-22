# @micdrop/gradium

[Micdrop website](https://micdrop.dev) | [Documentation](https://micdrop.dev/docs/ai-integration/provided-integrations/gradium)

Gradium STT and TTS implementation for [@micdrop/server](https://micdrop.dev/docs/server).

## Installation

```bash
npm install @micdrop/gradium
```

## Gradium TTS (Text-to-Speech)

### Usage with MicdropServer

```typescript
import { GradiumTTS } from '@micdrop/gradium'
import { MicdropServer } from '@micdrop/server'

const tts = new GradiumTTS({
  apiKey: process.env.GRADIUM_API_KEY || '',
  voiceId: 'Bla6SbVMczYnOhfK', // Gradium voice ID
  modelName: 'default', // Optional: model name
  outputFormat: 'pcm_16000', // Optional: audio format
  region: 'eu', // Optional: 'eu' or 'us'
  jsonConfig: {
    // Optional: advanced voice settings
    temp: 0.7, // Temperature (0-1.4)
    cfg_coef: 2.0, // Voice similarity (1.0-4.0)
    padding_bonus: 0, // Speed control (-4.0 to 4.0)
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
import { GradiumTTS } from '@micdrop/gradium'
import { Readable } from 'stream'

const tts = new GradiumTTS({
  apiKey: process.env.GRADIUM_API_KEY || '',
  voiceId: 'Bla6SbVMczYnOhfK',
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

## Gradium STT (Speech-to-Text)

Real-time transcription (ASR).

### Usage with MicdropServer

```typescript
import { GradiumSTT } from '@micdrop/gradium'
import { MicdropServer } from '@micdrop/server'

const stt = new GradiumSTT({
  apiKey: process.env.GRADIUM_API_KEY || '',
  modelName: 'default', // Optional: model name
  inputFormat: 'pcm_16000', // Optional: audio format
  language: 'en', // Optional: language hint
  region: 'eu', // Optional: 'eu' or 'us'
})

// Use with MicdropServer
new MicdropServer(socket, {
  stt,
  // ... other options
})
```

### Usage without MicdropServer

```typescript
import { GradiumSTT } from '@micdrop/gradium'
import { createReadStream } from 'fs'

const stt = new GradiumSTT({
  apiKey: process.env.GRADIUM_API_KEY || '',
  language: 'en',
})

stt.on('Transcript', (text) => console.log('Transcript:', text))
stt.on('Failed', (chunks) => console.error('Failed:', chunks.length, 'chunks'))

// Audio is raw PCM, 16 bits, 16 kHz, mono
stt.transcribe(createReadStream('speech.pcm'))
```

### Events

| Event        | Payload    | Description                                                                    |
| ------------ | ---------- | ------------------------------------------------------------------------------ |
| `Transcript` | `string`   | Transcription of one utterance. The text is empty when nothing was recognized. |
| `Failed`     | `Buffer[]` | Transcription gave up after its retries, with the audio chunks left pending.   |

See the [STT interface](https://micdrop.dev/docs/ai-integration/custom-integrations/custom-stt) for the full contract.

## Documentation

Read full [documentation of the Gradium integration for Micdrop](https://micdrop.dev/docs/ai-integration/provided-integrations/gradium) on the [website](https://micdrop.dev).

## License

MIT

## Author

Originally developed for [Raconte.ai](https://www.raconte.ai), created and open sourced by [Godefroy de Compreignac](https://github.com/Godefroy)

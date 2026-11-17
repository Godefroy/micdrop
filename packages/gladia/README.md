# @micdrop/gladia

[Micdrop website](https://micdrop.dev) | [Documentation](https://micdrop.dev/docs/speech-to-text/gladia)

Gladia implementation for [@micdrop/server](https://micdrop.dev/docs/server).

## Installation

```bash
npm install @micdrop/gladia
```

## Usage with MicdropServer

```typescript
import { GladiaSTT } from '@micdrop/gladia'
import { MicdropServer } from '@micdrop/server'

const stt = new GladiaSTT({
  apiKey: process.env.GLADIA_API_KEY || '',
})

// Use with MicdropServer
new MicdropServer(socket, {
  stt,
  // ... other options
})
```

## Usage without MicdropServer

```typescript
import { GladiaSTT } from '@micdrop/gladia'
import { createReadStream } from 'fs'

const stt = new GladiaSTT({
  apiKey: process.env.GLADIA_API_KEY || '',
})

stt.on('Transcript', (text) => console.log('Transcript:', text))
stt.on('Failed', (chunks) => console.error('Failed:', chunks.length, 'chunks'))

// Audio is raw PCM, 16 bits, 16 kHz, mono
stt.transcribe(createReadStream('speech.pcm'))
```

## Events

| Event        | Payload    | Description                                                                    |
| ------------ | ---------- | ------------------------------------------------------------------------------ |
| `Transcript` | `string`   | Transcription of one utterance. The text is empty when nothing was recognized. |
| `Failed`     | `Buffer[]` | Transcription gave up after its retries, with the audio chunks left pending.   |

See the [STT interface](https://micdrop.dev/docs/speech-to-text/custom) for the full contract.

## Documentation

Read full [documentation of the Gladia integration for Micdrop](https://micdrop.dev/docs/speech-to-text/gladia) on the [website](https://micdrop.dev).

## License

MIT

## Author

Originally developed for [Raconte.ai](https://www.raconte.ai), created and open sourced by [Godefroy de Compreignac](https://github.com/Godefroy)

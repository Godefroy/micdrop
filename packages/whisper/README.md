# @micdrop/whisper

[Micdrop website](https://micdrop.dev) | [Documentation](https://micdrop.dev/docs/ai-integration/provided-integrations/whisper)

Local Whisper speech to text for [@micdrop/server](https://micdrop.dev/docs/server).

Runs in your Node process through Transformers.js and ONNX Runtime, so there is
no API key, no server to start next to your own, and no audio leaving the
machine. The weights are downloaded on first use and shared by every call.

## Installation

```bash
npm install @micdrop/whisper
```

## Usage with MicdropServer

```typescript
import { WhisperSTT } from '@micdrop/whisper'
import { MicdropServer } from '@micdrop/server'

const stt = new WhisperSTT({
  model: 'base', // tiny, base, small, turbo, french, or any ONNX repository
  language: 'en',
})

// Use with MicdropServer
new MicdropServer(socket, {
  stt,
  // ... other options
})
```

## Usage without MicdropServer

```typescript
import { WhisperSTT } from '@micdrop/whisper'
import { createReadStream } from 'fs'

const stt = new WhisperSTT({
  model: 'base',
  language: 'en',
})

stt.on('Transcript', (text) => console.log('Transcript:', text))
stt.on('Failed', (chunks) => console.error('Failed:', chunks.length, 'chunks'))

// Audio is raw PCM, 16 bits, 16 kHz, mono
stt.transcribe(createReadStream('speech.pcm'))
```

## Events

| Event        | Payload    | Description                                                                                                             |
| ------------ | ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| `Transcript` | `string`   | Transcription of one utterance, in the order the utterances were spoken. The text is empty when nothing was recognized. |
| `Failed`     | `Buffer[]` | Transcription gave up after its retries, with the audio chunks left pending.                                            |

See the [STT interface](https://micdrop.dev/docs/ai-integration/custom-integrations/custom-stt) for the full contract.

## Picking a model

A checkpoint fine-tuned on one language beats a much heavier generic one. On
French sentences carrying proper nouns, numbers and homophones, the `french`
shorthand makes around 2% word errors where `turbo` makes 17%, at a third of
the latency and a fraction of the download.

```typescript
const stt = new WhisperSTT({ model: 'french', language: 'fr' })
```

## Documentation

Read full [documentation of the Whisper integration for Micdrop](https://micdrop.dev/docs/ai-integration/provided-integrations/whisper) on the [website](https://micdrop.dev), and the [guide on running Micdrop with local models](https://micdrop.dev/docs/ai-integration/local-models).

## License

MIT

## Author

Originally developed for [Raconte.ai](https://www.raconte.ai), created and open sourced by [Godefroy de Compreignac](https://github.com/Godefroy)

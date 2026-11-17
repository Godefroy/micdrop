# @micdrop/kokoro

[Micdrop website](https://micdrop.dev) | [Documentation](https://micdrop.dev/docs/text-to-speech/kokoro)

Local Kokoro text to speech for [@micdrop/server](https://micdrop.dev/docs/server).

Runs in your Node process through Transformers.js and ONNX Runtime, so there is
no API key, no server to start next to your own, and no text leaving the
machine. Kokoro is an 82 million parameter model with a quality well above what
its size suggests.

Kokoro only speaks English here, since `kokoro-js` phonemizes every input with
the English rules. Use [@micdrop/piper](https://micdrop.dev/docs/text-to-speech/piper) for the other languages.

## Installation

```bash
npm install @micdrop/kokoro
```

## Usage with MicdropServer

```typescript
import { KokoroTTS } from '@micdrop/kokoro'
import { MicdropServer } from '@micdrop/server'

const tts = new KokoroTTS({
  voice: 'britishFemale', // or any Kokoro voice id, such as af_heart
})

// Use with MicdropServer
new MicdropServer(socket, {
  tts,
  // ... other options
})
```

## Usage without MicdropServer

```typescript
import { KokoroTTS } from '@micdrop/kokoro'
import { Readable } from 'stream'

const tts = new KokoroTTS({
  voice: 'britishFemale',
})

// Audio is raw PCM, 16 bits, 16 kHz, mono
tts.on('Audio', (chunk) => console.log('Audio:', chunk.length, 'bytes'))
tts.on('Failed', (texts) => console.error('Failed:', texts))

tts.speak(Readable.from(['Hello! ', 'What can I do for you?']))
```

## Events

| Event    | Payload    | Description                                                              |
| -------- | ---------- | ------------------------------------------------------------------------ |
| `Audio`  | `Buffer`   | A chunk of audio, PCM 16 bits, 16 kHz, mono, ready to be played.         |
| `Failed` | `string[]` | Synthesis gave up after its retries, with the text that stayed unspoken. |

See the [TTS interface](https://micdrop.dev/docs/text-to-speech/custom) for the full contract.

## Documentation

Read full [documentation of the Kokoro integration for Micdrop](https://micdrop.dev/docs/text-to-speech/kokoro) on the [website](https://micdrop.dev), and the [guide on running Micdrop with local models](https://micdrop.dev/docs/local-models).

## License

MIT

## Author

Originally developed for [Raconte.ai](https://www.raconte.ai), created and open sourced by [Godefroy de Compreignac](https://github.com/Godefroy)

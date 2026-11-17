# @micdrop/pocket-tts

[Micdrop website](https://micdrop.dev) | [Documentation](https://micdrop.dev/docs/text-to-speech/pocket-tts)

Local [Pocket TTS](https://github.com/kyutai-labs/pocket-tts) text to speech for
[@micdrop/server](https://micdrop.dev/docs/server).

Runs in your Node process through the sherpa-onnx addon and ONNX Runtime, so
there is no API key, no Python next to your server, and no text leaving the
machine. Pocket TTS is a 100 million parameter model from Kyutai, built for the
CPU, that clones the voice of a few seconds of reference audio and hands its
audio over while it is still generating the rest.

It speaks English. Use [@micdrop/piper](https://micdrop.dev/docs/text-to-speech/piper)
for the other languages.

## Installation

Install the package:

```bash
npm install @micdrop/pocket-tts
```

Download the weights, converted to ONNX by the sherpa-onnx project:

```bash
curl -LO https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/sherpa-onnx-pocket-tts-int8-2026-01-26.tar.bz2
tar xf sherpa-onnx-pocket-tts-int8-2026-01-26.tar.bz2
rm sherpa-onnx-pocket-tts-int8-2026-01-26.tar.bz2
```

The archive weighs 98 MB and takes 190 MB on disk. A full precision archive,
`sherpa-onnx-pocket-tts-2026-01-26.tar.bz2`, exists next to it and is read the
same way.

## Usage with MicdropServer

```typescript
import { PocketTTS } from '@micdrop/pocket-tts'
import { MicdropServer } from '@micdrop/server'

const tts = new PocketTTS({
  modelDir: './sherpa-onnx-pocket-tts-int8-2026-01-26',
  voice: 'bria', // or the path to a wav of the voice to clone
})

// Use with MicdropServer
new MicdropServer(socket, {
  tts,
  // ... other options
})
```

## Usage without MicdropServer

```typescript
import { PocketTTS } from '@micdrop/pocket-tts'
import { Readable } from 'stream'

const tts = new PocketTTS({
  modelDir: './sherpa-onnx-pocket-tts-int8-2026-01-26',
  voice: 'bria',
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

## Voices

The voice comes from a reference recording rather than from a catalog: a few
seconds of someone speaking is enough for the model to answer in that voice.
The archive ships three samples in its `test_wavs` folder, reachable by name
through `BUNDLED_VOICES`, and any wav file works in their place.

```typescript
const tts = new PocketTTS({
  modelDir: './sherpa-onnx-pocket-tts-int8-2026-01-26',
  voice: './voices/my-voice.wav',
})
```

Clone a voice only with the consent of the person it belongs to, which the
[Kyutai license](https://github.com/kyutai-labs/pocket-tts#prohibited-use)
requires.

## Documentation

Read full [documentation of the Pocket TTS integration for Micdrop](https://micdrop.dev/docs/text-to-speech/pocket-tts) on the [website](https://micdrop.dev), and the [guide on running Micdrop with local models](https://micdrop.dev/docs/local-models).

## License

MIT

## Author

Originally developed for [Raconte.ai](https://www.raconte.ai), created and open sourced by [Godefroy de Compreignac](https://github.com/Godefroy)

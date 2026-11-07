# @micdrop/piper

[Micdrop website](https://micdrop.dev) | [Documentation](https://micdrop.dev/docs/ai-integration/provided-integrations/piper)

Local Piper text to speech for [@micdrop/server](https://micdrop.dev/docs/server).

Drives the Piper binary as a subprocess, so no text leaves the machine. Piper
voices are small VITS models covering around forty languages including French,
which makes this the option to reach for outside English.

## Installation

Install the package:

```bash
npm install @micdrop/piper
```

Install the binary:

```bash
pip install piper-tts
```

Download a voice, which comes as a pair of files that have to sit next to each
other:

```bash
mkdir -p voices && cd voices
BASE=https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR/siwis/medium
curl -LO $BASE/fr_FR-siwis-medium.onnx
curl -LO $BASE/fr_FR-siwis-medium.onnx.json
```

Piper ships a `download_voices` module, but calling it means finding the exact
interpreter `pip` installed it under, which is rarely the `python3` in your
path. Downloading the two files is shorter and works the same.

## Usage with MicdropServer

```typescript
import { PiperTTS } from '@micdrop/piper'
import { MicdropServer } from '@micdrop/server'

const tts = new PiperTTS({
  modelPath: './voices/fr_FR-siwis-medium.onnx',
})

// Use with MicdropServer
new MicdropServer(socket, {
  tts,
  // ... other options
})
```

## Usage without MicdropServer

```typescript
import { PiperTTS } from '@micdrop/piper'
import { Readable } from 'stream'

const tts = new PiperTTS({
  modelPath: './voices/fr_FR-siwis-medium.onnx',
})

// Audio is raw PCM, 16 bits, 16 kHz, mono
tts.on('Audio', (chunk) => console.log('Audio:', chunk.length, 'bytes'))
tts.on('Failed', (texts) => console.error('Failed:', texts))

tts.speak(Readable.from(['Hello! ', 'What can I do for you?']))
```

## Events

| Event    | Payload    | Description                                                                                                   |
| -------- | ---------- | ------------------------------------------------------------------------------------------------------------- |
| `Audio`  | `Buffer`   | A chunk of audio, PCM 16 bits, 16 kHz, mono, ready to be played.                                              |
| `Failed` | `string[]` | The Piper process exited with an error, or the binary cannot be run (reported once). The payload stays empty. |

See the [TTS interface](https://micdrop.dev/docs/ai-integration/custom-integrations/custom-tts) for the full contract.

## Documentation

Read full [documentation of the Piper integration for Micdrop](https://micdrop.dev/docs/ai-integration/provided-integrations/piper) on the [website](https://micdrop.dev), and the [guide on running Micdrop with local models](https://micdrop.dev/docs/ai-integration/local-models).

## License

MIT

## Author

Originally developed for [Raconte.ai](https://www.raconte.ai), created and open sourced by [Godefroy de Compreignac](https://github.com/Godefroy)

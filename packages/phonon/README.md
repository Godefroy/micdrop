# @micdrop/phonon

[Micdrop website](https://micdrop.dev) | [Documentation](https://micdrop.dev/docs/ai-integration/local-models)

Local [Phonon](https://github.com/gradium-ai/xn-ptts) text to speech for
[@micdrop/server](https://micdrop.dev/docs/server).

Phonon is Gradium's on-device model, built on Kyutai's Pocket TTS. This
package runs its WebAssembly build on a worker thread of your Node process, so
there is no API key, no server next to yours, no native addon to compile, and
no text leaving the machine. It generates several times faster than real time
on a single core and hands its audio over by frames of 80 ms, so the first
words reach the client in about a hundred milliseconds.

## Installation

Install the package:

```bash
npm install @micdrop/phonon
```

The weights are supplied by Gradium. Extract the archive they send you, which
holds `model.q8.gguf`, `tokenizer.json`, `config.json` and a `voices` folder.

## Usage with MicdropServer

```typescript
import { PhononTTS } from '@micdrop/phonon'
import { MicdropServer } from '@micdrop/server'

const tts = new PhononTTS({
  modelDir: './phonon-7e71a02d.200',
  voice: 'Freya',
})

// Use with MicdropServer
new MicdropServer(socket, {
  tts,
  // ... other options
})
```

## Usage without MicdropServer

```typescript
import { PhononTTS } from '@micdrop/phonon'
import { Readable } from 'stream'

const tts = new PhononTTS({
  modelDir: './phonon-7e71a02d.200',
  voice: 'Freya',
})

// Audio is raw PCM, 16 bits, 16 kHz, mono
tts.on('Audio', (chunk) => console.log('Audio:', chunk.length, 'bytes'))
tts.on('Failed', (texts) => console.error('Failed:', texts))

tts.speak(Readable.from(['Hello! ', 'What can I do for you?']))
```

## Options

| Option        | Default   | Description                                                                                 |
| ------------- | --------- | ------------------------------------------------------------------------------------------- |
| `modelDir`    |           | Folder holding the model files.                                                             |
| `voice`       | `Freya`   | A voice of the `voices` folder, or the path to a `.safetensors` voice file.                 |
| `language`    | `en`      | How numbers and symbols are read: `en`, `fr`, `de`, `es`, `pt` or a locale such as `fr-FR`. |
| `rewrites`    | `default` | Word rewrites on the text: `default` (numbers, currency, emails, urls), `all` or `none`.    |
| `temperature` | `0.3`     | Sampling temperature.                                                                       |
| `seed`        | random    | Sampling seed, so the same sentence comes out the same way.                                 |
| `quant`       | `q8`      | Weight precision of the flow transformer, `q8` or `f32`.                                    |
| `warmup`      | `true`    | Synthesizes one word at startup, so the first sentence of the call starts sooner.           |

The language picks the normalization rules only. The voice and the accent
come from the model folder, so a call in French needs Gradium's French model.

Every call with the same model, language and precision shares one worker, which
generates the sentences one after the other.

## Events

| Event    | Payload    | Description                                                              |
| -------- | ---------- | ------------------------------------------------------------------------ |
| `Audio`  | `Buffer`   | A chunk of audio, PCM 16 bits, 16 kHz, mono, ready to be played.         |
| `Failed` | `string[]` | Synthesis gave up after its retries, with the text that stayed unspoken. |

See the [TTS interface](https://micdrop.dev/docs/ai-integration/custom-integrations/custom-tts) for the full contract.

## Building the WebAssembly module

The published package ships the module in `wasm/`. To build it from source,
install Rust with the `wasm32-unknown-unknown` target, wasm-pack 0.12 or later
and binaryen 124 or later, then run:

```bash
pnpm build:wasm
```

The script builds the `gradium-ai/xn-ptts` commit it pins. Set `XN_PTTS_DIR` to
build from a checkout you already have.

## License

MIT. The Phonon runtime is dual licensed MIT and Apache 2.0, the weights come
with Gradium's own terms.

## Author

Originally developed for [Raconte.ai](https://www.raconte.ai), created and open sourced by [Godefroy de Compreignac](https://github.com/Godefroy)

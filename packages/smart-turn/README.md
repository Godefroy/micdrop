# 🖐️🎤 Micdrop: Real-Time Voice Conversations with AI

[Micdrop website](https://micdrop.dev) | [Documentation](https://micdrop.dev/docs/client) | [Basic example](../../examples/basic) | [Demo](../../examples/advanced)

Micdrop is a set of open source Typescript packages to build real-time voice conversations with AI agents. It handles all the complexities on the client and server side (microphone, speaker, VAD, network communication, etc) and provides ready-to-use implementations for various AI providers.

# @micdrop/smart-turn

Semantic end of turn detection in Typescript, for the browser and for Node. It tells you whether a speaker has finished their sentence, from the sound of it, so an agent can answer as soon as a question lands and keep waiting through a hesitation.

This package stands on its own. It depends on no other Micdrop package, so any voice application can use it.

It runs [Smart Turn v3](https://huggingface.co/pipecat-ai/smart-turn-v3), the open model published by the Pipecat team at Daily under a BSD 2 clause licence.

## What it adds to a voice detector

A voice activity detector such as Silero hears whether someone is speaking right now. Closing a turn then means waiting for a fixed amount of silence, and that number is a compromise: short enough to answer quickly, long enough to survive a pause between two words.

Smart Turn hears whether the sentence has landed. Pair the two and the silence you wait for becomes adaptive, short when the speaker is clearly done and long when they are visibly searching for a word.

## Installation

```bash
# in a browser
npm install @micdrop/smart-turn onnxruntime-web
# on a server
npm install @micdrop/smart-turn onnxruntime-node
# on a phone
npm install @micdrop/smart-turn onnxruntime-react-native
```

## Usage in a browser

```ts
import { SmartTurn } from '@micdrop/smart-turn'
import '@micdrop/smart-turn/web'

const smartTurn = new SmartTurn()
await smartTurn.load()

// Every chunk of microphone audio, while the speaker is talking
smartTurn.push(samples, 48000)

// When the voice detector hears a pause
const { complete, probability } = await smartTurn.predict()
if (complete) answer()

// Once the turn is over
smartTurn.reset()
```

Importing `@micdrop/smart-turn/web` is what brings the ONNX runtime into your bundle, so an application that never asks for turn detection never pays for it.

In an app built with Vite, add the `micdrop()` plugin from `@micdrop/web/vite` (strongly recommended). Vite then emits the ONNX runtime WebAssembly with your app, where it would otherwise be fetched from unpkg when the model loads. The checkpoint still comes from Hugging Face unless `setSmartTurnOptions({ model })` points elsewhere.

## Usage on a phone

```ts
import { SmartTurn } from '@micdrop/smart-turn'
import { setSmartTurnOptions } from '@micdrop/smart-turn/react-native'

// Ship the checkpoint with the app rather than fetching it on the first call
setSmartTurnOptions({ model: modelPath })

const smartTurn = new SmartTurn()
```

The phone runs the model on its own processor through the native runtime, with
none of the WebAssembly penalty a browser pays, so the quantised checkpoint of
eight megabytes is the right one there.

## Usage on a server

```ts
import { SmartTurn } from '@micdrop/smart-turn'
import { setSmartTurnOptions } from '@micdrop/smart-turn/node'

// Keep the checkpoint next to the code so the server never reaches out at boot
setSmartTurnOptions({ model: './smart-turn-v3.2-cpu.onnx' })

const smartTurn = new SmartTurn()
const { complete } = await smartTurn.predictOnce(turnAudio, 16000)
```

## Inside Micdrop

In a Micdrop call, hand it to the client and it decides when the turn ends:

```ts
import { Micdrop } from '@micdrop/web'
import { SmartTurn } from '@micdrop/smart-turn'
import '@micdrop/smart-turn/web'

await Micdrop.start({
  url: 'wss://example.com/call',
  vad: 'silero',
  turnDetector: new SmartTurn(),
})
```

The voice detector keeps cutting the silences out of what reaches the server, and the turn stays open through the pauses the model reads as unfinished. Read [Turn Detection](https://micdrop.dev/docs/client/turn-detection) for the whole picture.

The server takes the same object, for the browsers where the model has nowhere to run:

```ts
new MicdropServer(socket, { agent, stt, tts, turnDetector: new SmartTurn() })
```

That one only ever decides to wait longer, since the client has already closed its turn by then, so prefer the client whenever you can.

## How it works

The model reads the last eight seconds of the turn as a Whisper log mel picture, eighty frequency bands every ten milliseconds, and answers with one probability. This package carries that whole front end in Typescript, including the four hundred point transform Whisper needs, which no power of two algorithm covers.

Building those eight seconds in one go costs about thirty five milliseconds on a laptop and a fifth of a second on a mid range phone, right at the moment where any delay is heard. So `SmartTurn.push()` builds the picture as the audio arrives, one transform every ten milliseconds, which costs half a percent of a core. When the speaker pauses, only the loudness scaling is left, a couple of milliseconds.

Both paths are available: `TurnFeatures` streams, `extractFeatures()` takes a turn that is already in memory. They land on the same answer, verified on the model's own test set.

The streaming path stops its window shortly after the last word rather than at the last sample. A voice detector needs half a second of silence to call a turn over, and the model reads a long silence as a sentence that has landed, so handing it that silence would undo the very hesitation it is there to catch. On the test set, trimming holds 94% of unfinished sentences whatever the detector waited, against 82% at half a second of silence and 78% at a second and a half.

## Measurements

Model, on the balanced French and English subset of [smart-turn-data-v3.1-test](https://huggingface.co/datasets/pipecat-ai/smart-turn-data-v3.1-test), 240 turns:

| Checkpoint | Size | French | English |
| --- | --- | --- | --- |
| `smart-turn-v3.2-gpu` (full precision) | 31 MB | 95.8% | 99.2% |
| `smart-turn-v3.2-cpu` (quantised) | 8.3 MB | 93.3% | 96.7% |

Time to answer once the speaker pauses, Apple M2, Chromium, with the features already built:

| Where | Backend | Laptop | Mid range phone | Slow phone |
| --- | --- | --- | --- | --- |
| Browser | WebGPU | 25 ms | 26 ms | 27 ms |
| Browser | WebAssembly, one thread | 194 ms | 837 ms | 1244 ms |
| Browser | WebAssembly, four threads | 68 ms | 232 ms | 345 ms |
| Node | one core | 37 ms | | |
| Node | four cores | 14 ms | | |
| React Native | native runtime | not measured | | |

The phone columns emulate a processor four and six times slower than the M2. WebGPU barely moves between them, since the work leaves the processor. Four WebAssembly threads need the page to be cross origin isolated.

React Native runs the same graph on the native runtime rather than in WebAssembly, which is the build Node uses above, so expect the order of a few tens of milliseconds on a recent phone. Nothing here was measured on a device.

Building the picture as the audio arrives costs 0.5 ms per 100 ms of audio on the M2 and 2.8 ms on the slowest setting, next to 0.3 ms and 1.7 ms per 32 ms window for Silero. Reading it at the end of the turn takes 0.5 ms to 3.4 ms.

Memory, on top of the 38 MB an ONNX runtime already holds for Silero: 18 MB for the quantised checkpoint, 83 MB for the full precision one.

## API

- `new SmartTurn({ threshold, model })` holds one conversation
- `push(samples, sampleRate)` feeds the audio of the current turn, resampling when needed
- `predict()` answers `{ probability, complete, duration }`
- `predictOnce(samples, sampleRate)` answers about a turn already in memory
- `reset()` starts the next turn, `release()` frees the runtime
- `setSmartTurnOptions({ model, executionProvider, wasmPath })` says where the checkpoint comes from

## License

MIT for this package, BSD 2 clause for the model.

## Author

Originally developed for [Raconte.ai](https://www.raconte.ai), created and open sourced by [Godefroy de Compreignac](https://github.com/Godefroy)

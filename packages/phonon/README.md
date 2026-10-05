# @micdrop/phonon

[Micdrop website](https://micdrop.dev) | [Documentation](https://micdrop.dev/docs/ai-integration/local-models)

Local [Phonon](https://huggingface.co/collections/gradium/phonon) text to
speech for [@micdrop/server](https://micdrop.dev/docs/server).

Phonon is Gradium's on-device model, built on Kyutai's Pocket TTS. This
package runs its WebAssembly build ([`phonon-tts`](https://www.npmjs.com/package/phonon-tts))
on a worker thread of your Node process, so there is no API key, no server
next to yours, no native addon to compile, and no text leaving the machine. It
generates faster than real time on a single core and hands its audio over by
frames of 80 ms, so the first words reach the client in a fraction of a second.

## Installation

```bash
npm install @micdrop/phonon
```

The model and the voices are downloaded from Hugging Face on first use, into
the cache the Hugging Face libraries share (`~/.cache/huggingface/hub`, or
`HF_HUB_CACHE`). Once there, they load offline.

## Usage with MicdropServer

```typescript
import { PhononTTS } from '@micdrop/phonon'
import { MicdropServer } from '@micdrop/server'

const tts = new PhononTTS({ voice: 'Easton' })

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

const tts = new PhononTTS({ voice: 'Easton' })

// Audio is raw PCM, 16 bits, 16 kHz, mono
tts.on('Audio', (chunk) => console.log('Audio:', chunk.length, 'bytes'))
tts.on('Failed', (texts) => console.error('Failed:', texts))

tts.speak(Readable.from(['Hello! ', 'What can I do for you?']))
```

## Models

Phonon 31M in English is the default, under Apache 2.0. The 40M models sound
better and speak more languages, under CC BY-NC 4.0, which rules out
commercial use. Their weights are gated: accept the terms on the model page,
then set `HF_TOKEN` (or the `hfToken` option) to a token of that account.

| Model                                                                                            | Languages      | License      |
| ------------------------------------------------------------------------------------------------ | -------------- | ------------ |
| [`hf://gradium/phonon-31m-en`](https://huggingface.co/gradium/phonon-31m-en)                     | English        | Apache 2.0   |
| [`hf://gradium/phonon-40m-en`](https://huggingface.co/gradium/phonon-40m-en)                     | English        | CC BY-NC 4.0 |
| [`hf://gradium/phonon-40m-fr`](https://huggingface.co/gradium/phonon-40m-fr)                     | French         | CC BY-NC 4.0 |
| [`hf://gradium/phonon-40m-de`](https://huggingface.co/gradium/phonon-40m-de)                     | German         | CC BY-NC 4.0 |
| [`hf://gradium/phonon-40m-es`](https://huggingface.co/gradium/phonon-40m-es)                     | Spanish        | CC BY-NC 4.0 |
| [`hf://gradium/phonon-40m-pt`](https://huggingface.co/gradium/phonon-40m-pt)                     | Portuguese     | CC BY-NC 4.0 |
| [`hf://gradium/phonon-40m-multilingual`](https://huggingface.co/gradium/phonon-40m-multilingual) | All five above | CC BY-NC 4.0 |

```typescript
import { PHONON_MODELS, PhononTTS } from '@micdrop/phonon'

const tts = new PhononTTS({
  model: PHONON_MODELS['phonon-40m-fr'].model,
  voice: 'Noémie',
})
```

`model` also takes `hf://owner/name@revision`, to pin a commit, or the path
to a folder laid out as these repos are.

## Voices

The 102 voices of [gradium/phonon-voices](https://huggingface.co/gradium/phonon-voices)
work with every model: English (US and UK, plus character voices), French,
German, Spanish (Spain and Mexico) and Portuguese (Brazil). Pick one by name
or id, and listen to them on that page. `PHONON_VOICES` lists them with their
language, locale and gender.

A voice also reads the text in its own language when `language` is left out,
so `voice: 'Noémie'` normalizes numbers the French way. Pair it with a model
that speaks that language.

Left out, the voice is the model's own (`default-voice.safetensors`). A path to
a `.safetensors` voice file works too, such as one made with the `create_voice`
tool of the [runtime](https://github.com/gradium-ai/xn-ptts).

## Options

| Option        | Default                | Description                                                                                   |
| ------------- | ---------------------- | --------------------------------------------------------------------------------------------- |
| `model`       | Phonon 31M, in English | A Hugging Face repo, `hf://owner/name[@revision]`, or the path to a model folder.             |
| `voice`       | the model's own        | A catalog voice by name or id, a voice of the model folder, or the path to a `.safetensors`.  |
| `language`    | the voice's, else `en` | How numbers and symbols are read: `en`, `fr`, `de`, `es`, `pt`, `none` or a locale (`fr-FR`). |
| `rewrites`    | `default`              | Word rewrites on the text: `default` (numbers, currency, emails, urls), `all` or `none`.      |
| `conditions`  |                        | Values for the conditioners of the model's `config.json`, such as `{ padding_bonus: 0.5 }`.   |
| `temperature` | `0.3`                  | Sampling temperature.                                                                         |
| `seed`        | random                 | Sampling seed, so the same sentence comes out the same way.                                   |
| `quant`       | `q8`                   | Weight precision of the flow transformer, `q8` or `f32`.                                      |
| `hfToken`     | `HF_TOKEN`             | Hugging Face token, for the gated 40M models.                                                 |
| `cacheDir`    | `HF_HUB_CACHE`         | Hugging Face cache folder, `~/.cache/huggingface/hub` when unset.                             |
| `warmup`      | `true`                 | Synthesizes one word at startup, so the first sentence of the call starts sooner.             |

The language picks the normalization rules only. The model decides which
languages sound right, and a warning says so when the two disagree.

Every call with the same model, language and precision shares one worker,
which generates the sentences one after the other.

## Events

| Event    | Payload    | Description                                                      |
| -------- | ---------- | ---------------------------------------------------------------- |
| `Audio`  | `Buffer`   | A chunk of audio, PCM 16 bits, 16 kHz, mono, ready to be played. |
| `Failed` | `string[]` | Synthesis failed, with the text that stayed unspoken.            |

See the [TTS interface](https://micdrop.dev/docs/ai-integration/custom-integrations/custom-tts) for the full contract.

## License

MIT. The Phonon runtime is dual licensed MIT and Apache 2.0. Phonon 31M and
the voices are under Apache 2.0, the 40M models under CC BY-NC 4.0.

## Author

Originally developed for [Raconte.ai](https://www.raconte.ai), created and open sourced by [Godefroy de Compreignac](https://github.com/Godefroy)

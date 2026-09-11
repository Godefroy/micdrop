# @micdrop/qwen-tts

[Micdrop website](https://micdrop.dev) | [Documentation](https://micdrop.dev/docs/ai-integration/provided-integrations/qwen-tts)

Local [Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS) text to speech for
[@micdrop/server](https://micdrop.dev/docs/server).

Qwen3-TTS is an open source text to speech model from Alibaba. It is the only
local voice in Micdrop that speaks ten languages with one checkpoint: Chinese,
English, French, German, Italian, Japanese, Korean, Portuguese, Russian and
Spanish. It accepts an instruction such as `"Very happy"` or `"speak slowly"`
that changes how a sentence is read, and it can clone a voice from three
seconds of reference audio.

The model runs in a separate server, so generation uses the GPU while your app
keeps its own process. On a Mac, that server is
[mlx-audio](https://github.com/Blaizzy/mlx-audio), which uses the Apple Silicon
GPU through MLX. Nothing leaves the machine and there is no API key.

Qwen3-TTS needs more computation than the other local voices, because it
generates audio with a language model. On a machine without a GPU, use
[@micdrop/piper](https://micdrop.dev/docs/ai-integration/provided-integrations/piper)
or
[@micdrop/kokoro](https://micdrop.dev/docs/ai-integration/provided-integrations/kokoro).

## Installation

Install the package:

```bash
npm install @micdrop/qwen-tts
```

Start an mlx-audio server next to your app, on Python 3.10 or above:

```bash
uv run --with "mlx-audio[server]" python -m mlx_audio.server --port 8000
```

`pip install "mlx-audio[server]"` in a virtual environment works too. The
server downloads the checkpoint on the first request, 2.6 GB for the default
one, and keeps it in memory.

## Usage with MicdropServer

```typescript
import { MicdropServer } from '@micdrop/server'
import { Qwen3TTS } from '@micdrop/qwen-tts'

const tts = new Qwen3TTS({
  url: 'http://localhost:8000',
  voice: 'Ryan',
  language: 'en-US',
})

// Use with MicdropServer
new MicdropServer(socket, {
  tts,
  // ... other options
})
```

## Usage without MicdropServer

```typescript
import { Qwen3TTS } from '@micdrop/qwen-tts'
import { Readable } from 'stream'

const tts = new Qwen3TTS({ voice: 'Ryan' })

// Audio is raw PCM, 16 bits, 16 kHz, mono
tts.on('Audio', (chunk) => console.log('Audio:', chunk.length, 'bytes'))
tts.on('Failed', (texts) => console.error('Failed:', texts))

tts.speak(Readable.from(['Hello! ', 'What can I do for you?']))
```

## Events

| Event    | Payload    | Description                                                            |
| -------- | ---------- | ---------------------------------------------------------------------- |
| `Audio`  | `Buffer`   | A chunk of audio, PCM 16 bits, 16 kHz, mono, ready to be played.       |
| `Failed` | `string[]` | The server answered with an error, with the text that stayed unspoken. |

See the [TTS interface](https://micdrop.dev/docs/ai-integration/custom-integrations/custom-tts) for the full contract.

## Options

| Option              | Default                                              | Description                                                                  |
| ------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| `url`               | `http://localhost:8000`                              | Address of the mlx-audio server.                                             |
| `model`             | `mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-6bit` | Checkpoint the server loads.                                                 |
| `voice`             | `Ryan`                                               | Preset speaker of the CustomVoice checkpoints.                               |
| `language`          | Guessed from the text                                | A code (`fr`), a locale (`fr-FR`) or the name the checkpoint uses (`french`) |
| `instruct`          | —                                                    | How the sentence is read, or the voice to invent on VoiceDesign.             |
| `refAudio`          | —                                                    | Path, on the server, to a few seconds of speech to clone.                    |
| `refText`           | —                                                    | What the reference audio says.                                               |
| `streamingInterval` | `0.5`                                                | Audio generated before a chunk is sent, in seconds.                          |
| `temperature`       | `0.9`                                                | Sampling temperature.                                                        |
| `topK`              | `50`                                                 | Sampling window, in number of candidates.                                    |
| `topP`              | `1`                                                  | Sampling window, in cumulated probability.                                   |
| `repetitionPenalty` | `1.05`                                               | Penalty on repeated audio tokens, which keeps a voice on track.              |
| `maxTokens`         | `500`                                                | Ceiling on the audio tokens of one sentence, 12.5 per second.                |
| `warmup`            | `true`                                               | Loads the checkpoint on the server at startup.                               |

## Voices

The CustomVoice checkpoints include nine speakers, listed in `QWEN_SPEAKERS`.
Each speaker was recorded in one language and can read all ten. The language of
the call is set by `language`, not by the speaker.

| Speaker                        | Recorded in                           |
| ------------------------------ | ------------------------------------- |
| `Ryan`, `Aiden`                | English                               |
| `Vivian`, `Serena`, `Uncle_Fu` | Chinese                               |
| `Dylan`, `Eric`                | Chinese, Beijing and Sichuan dialects |
| `Ono_Anna`                     | Japanese                              |
| `Sohee`                        | Korean                                |

`language` accepts a locale such as `fr-FR`, a code such as `fr`, or the
checkpoint name `french`. `resolveLanguage()` returns the value sent to the
model. For a language outside the ten, it returns `auto`, and the model detects
the language from the text.

`instruct` changes how the speaker talks, not which speaker it is:

```typescript
new Qwen3TTS({ voice: 'Serena', instruct: 'Warm and reassuring, speak slowly' })
```

## Checkpoints

The server loads the checkpoint named by `model` and keeps each checkpoint it
has loaded in memory.

| Checkpoint                                           | Downloads | What it does                                       |
| ---------------------------------------------------- | --------- | -------------------------------------------------- |
| `mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-6bit` | 2.6 GB    | The default: nine speakers, style instructions     |
| `mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-6bit` | 1.8 GB    | 100 ms faster, less accurate reading               |
| `mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-6bit` | 2.6 GB    | Designs a voice from the description in `instruct` |
| `mlx-community/Qwen3-TTS-12Hz-1.7B-Base-6bit`        | 2.6 GB    | Clones the voice of `refAudio`                     |

Prefer the 6 bit exports. On the same sentences, the 8 bit export of the 1.7B
was slower than real time, while the 6 bit one was faster.

## Cloning a voice

A Base checkpoint has no preset speakers. It reads a sentence in the voice of a
recording, given the recording and its transcript. The mlx-audio server opens
the file, so the path must exist on the machine that runs the server.

```typescript
new Qwen3TTS({
  model: 'mlx-community/Qwen3-TTS-12Hz-1.7B-Base-6bit',
  refAudio: '/srv/voices/marie.wav',
  refText: 'Bonjour, je suis Marie et je vous accompagne aujourd’hui.',
  language: 'fr-FR',
})
```

Clone a voice only with the consent of the person it belongs to.

## Another server

Any server that answers `POST /v1/audio/speech` with raw PCM at 24 kHz can
replace mlx-audio, on a Mac or on another machine. The request contains the
OpenAI fields (`model`, `input`, `voice`) and the Qwen fields (`instruct`,
`lang_code`, `ref_audio`, `ref_text`), with `stream` set to true and
`response_format` set to `pcm`.

## Documentation

Read full [documentation of the Qwen3-TTS integration for Micdrop](https://micdrop.dev/docs/ai-integration/provided-integrations/qwen-tts) on the [website](https://micdrop.dev), and the [guide on running Micdrop with local models](https://micdrop.dev/docs/ai-integration/local-models).

## License

MIT

## Author

Originally developed for [Raconte.ai](https://www.raconte.ai), created and open sourced by [Godefroy de Compreignac](https://github.com/Godefroy)

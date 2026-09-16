# @micdrop/openai

[Micdrop website](https://micdrop.dev) | [Documentation](https://micdrop.dev/docs/ai-integration/provided-integrations/openai)

OpenAI implementation for [@micdrop/server](https://micdrop.dev/docs/server).

## Installation

```bash
npm install @micdrop/openai
```

## OpenAI Agent

### Usage with MicdropServer

```typescript
import { OpenaiAgent } from '@micdrop/openai'
import { MicdropServer } from '@micdrop/server'

const agent = new OpenaiAgent({
  apiKey: process.env.OPENAI_API_KEY || '',
  model: 'gpt-4o', // Default model
  systemPrompt: 'You are a helpful assistant',

  // Advanced features (optional)
  autoEndCall: true, // Automatically end call when user requests
  autoSemanticTurn: true, // Handle incomplete sentences
  autoIgnoreUserNoise: true, // Filter out meaningless sounds

  // Custom OpenAI settings (optional)
  settings: {
    temperature: 0.7,
    max_output_tokens: 150,
  },
})

// Use with MicdropServer
new MicdropServer(socket, {
  agent,
  // ... other options
})
```

### Usage without MicdropServer

```typescript
import { OpenaiAgent } from '@micdrop/openai'

const agent = new OpenaiAgent({
  apiKey: process.env.OPENAI_API_KEY || '',
  systemPrompt: 'You are a helpful assistant',
})

agent.on('Message', (message) => console.log('Message:', message))

agent.addUserMessage('Hello, what can you do?')

// The answer is a text stream, written as the model generates it
agent.answer().on('data', (chunk) => process.stdout.write(chunk))
```

### Events

| Event                   | Payload                   | Description                                                             |
| ----------------------- | ------------------------- | ----------------------------------------------------------------------- |
| `Message`               | `MicdropConversationItem` | A message, a tool call or a tool result was added to the conversation.  |
| `ToolCall`              | `MicdropToolCall`         | A tool declared with `emitOutput` ran, with its parameters and output.  |
| `CancelLastUserMessage` | none                      | The last user message was dropped because it carried no intent.         |
| `SkipAnswer`            | none                      | The agent stays silent and waits for the user to finish their sentence. |
| `EndCall`               | none                      | The agent decided that the call is over.                                |
| `Failed`                | none                      | The agent gave up generating an answer after its retries.               |

See the [Agent interface](https://micdrop.dev/docs/ai-integration/custom-integrations/custom-agent) for the full contract.

## OpenAI STT (Speech-to-Text)

### Usage with MicdropServer

```typescript
import { OpenaiSTT } from '@micdrop/openai'
import { MicdropServer } from '@micdrop/server'

const stt = new OpenaiSTT({
  apiKey: process.env.OPENAI_API_KEY || '',
  model: 'gpt-4o-transcribe',
  language: 'en',
})

// Use with MicdropServer
new MicdropServer(socket, {
  stt,
  // ... other options
})
```

### Usage without MicdropServer

```typescript
import { OpenaiSTT } from '@micdrop/openai'
import { createReadStream } from 'fs'

const stt = new OpenaiSTT({
  apiKey: process.env.OPENAI_API_KEY || '',
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

## OpenAI TTS (Text-to-Speech)

### Usage with MicdropServer

```typescript
import { OpenaiTTS } from '@micdrop/openai'
import { MicdropServer } from '@micdrop/server'

const tts = new OpenaiTTS({
  apiKey: process.env.OPENAI_API_KEY || '',
  model: 'gpt-4o-mini-tts', // Default model
  voice: 'alloy', // Default voice

  // Prosody control, only for gpt-4o-mini-tts (optional)
  instructions: 'Speak in a calm and friendly tone',

  // Speech speed from 0.25 to 4.0, only for tts-1 / tts-1-hd (optional)
  // speed: 1,
})

// Use with MicdropServer
new MicdropServer(socket, {
  tts,
  // ... other options
})
```

### Usage without MicdropServer

```typescript
import { OpenaiTTS } from '@micdrop/openai'
import { Readable } from 'stream'

const tts = new OpenaiTTS({
  apiKey: process.env.OPENAI_API_KEY || '',
  voice: 'alloy',
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

> **Language**: OpenAI's speech API has no language parameter, the voice follows the language of the input text. To influence the spoken language or accent, use `instructions` (e.g. `'Speak in French'`) with the `gpt-4o-mini-tts` model.

## OpenAI Realtime

`OpenaiRealtime` is a [realtime model](https://micdrop.dev/docs/server/realtime) running on the OpenAI Realtime API. It hears the user and answers with its own voice, in place of a speech to text, an agent and a text to speech.

```typescript
import { OpenaiRealtime } from '@micdrop/openai'
import { MicdropServer } from '@micdrop/server'

const realtime = new OpenaiRealtime({
  apiKey: process.env.OPENAI_API_KEY || '',
  model: 'gpt-realtime-2.1', // Default model
  voice: 'marin', // Default voice
  systemPrompt: 'You are a helpful assistant',
  language: 'en', // Optional, helps the transcription of the user
})

new MicdropServer(socket, {
  realtime,
  generateFirstMessage: true,
})
```

It emits the events of an agent, plus `Audio` (the voice of the model, PCM 16 bits, 16 kHz, mono) and `PartialMessage` (the transcript of the answer so far).

## Documentation

Read full [documentation of the OpenAI integration for Micdrop](https://micdrop.dev/docs/ai-integration/provided-integrations/openai) on the [website](https://micdrop.dev).

## License

MIT

## Author

Originally developed for [Raconte.ai](https://www.raconte.ai), created and open sourced by [Godefroy de Compreignac](https://github.com/Godefroy)

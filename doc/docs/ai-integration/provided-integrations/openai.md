# OpenAI

OpenAI implementation for [@micdrop/server](../../server).

This package provides AI agent, speech-to-text and text-to-speech implementations using OpenAI's API.

## Installation

```bash
npm install @micdrop/openai
```

## OpenAI Agent

### Usage

```typescript
import { OpenaiAgent } from '@micdrop/openai'
import { MicdropServer } from '@micdrop/server'

const agent = new OpenaiAgent({
  apiKey: process.env.OPENAI_API_KEY || '',
  model: 'gpt-4o', // Default model
  systemPrompt: 'You are a helpful assistant',

  // Custom OpenAI Responses API settings (optional)
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

### Options

| Option                | Type                                                                                                                              | Default     | Description                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------ |
| `apiKey`              | `string`                                                                                                                          | Required\*  | Your OpenAI API key (required if `openai` not provided)                  |
| `openai`              | `OpenAI`                                                                                                                          | Optional    | OpenAI instance (alternative to `apiKey`)                                |
| `model`               | `string`                                                                                                                          | `'gpt-4o'`  | OpenAI model to use                                                      |
| `systemPrompt`        | `string`                                                                                                                          | Required    | System prompt for the agent                                              |
| `retryDelay`          | `number`                                                                                                                          | `1000`      | Delay in milliseconds between retry attempts                             |
| `maxRetry`            | `number`                                                                                                                          | `3`         | Maximum number of retries on API failures                                |
| `maxSteps`            | `number`                                                                                                                          | `5`         | Maximum number of steps (for tool calls)                                 |
| `autoEndCall`         | `boolean \| string`                                                                                                               | `false`     | [Auto-detect when user wants to end call](../../server/auto-end-call)    |
| `autoSemanticTurn`    | `boolean \| string`                                                                                                               | `false`     | [Handle incomplete user sentences](../../server/semantic-turn-detection) |
| `autoIgnoreUserNoise` | `boolean \| string`                                                                                                               | `false`     | [Filter meaningless user sounds](../../server/user-noise-filtering)      |
| `extract`             | [`ExtractJsonOptions`](../../server/extract#json-extraction) \| [`ExtractTagOptions`](../../server/extract#custom-tag-extraction) | `undefined` | Extract structured data from responses                                   |
| `onBeforeAnswer`      | `function`                                                                                                                        | `undefined` | Hook called before answer generation - return `true` to skip generation  |
| `settings`            | `object`                                                                                                                          | `{}`        | Additional OpenAI Responses API parameters                               |

The OpenAI Agent supports adding and removing custom tools to extend its capabilities. For detailed information about tool management, see the [Tools documentation](../../server/tools).

### Advanced Features

The OpenAI Agent supports advanced features for improved conversation handling:

- **[Auto End Call](../../server/auto-end-call)**: Automatically detect when users want to end the conversation
- **[Semantic Turn Detection](../../server/semantic-turn-detection)**: Handle incomplete sentences for natural flow
- **[User Noise Filtering](../../server/user-noise-filtering)**: Filter out meaningless sounds and filler words
- **[Extract Value from Answer](../../server/extract)**: Extract structured data from responses
- **[Tools](../../server/tools)**: Add custom tools to the agent

### Langfuse Integration

You can integrate Langfuse for observability by using the `openai` option with a Langfuse-wrapped OpenAI client:

```typescript
import { OpenaiAgent } from '@micdrop/openai'
import { Langfuse, observeOpenAI } from 'langfuse'
import OpenAI from 'openai'

// Initialize Langfuse
const langfuse = new Langfuse({
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  baseUrl: process.env.LANGFUSE_BASE_URL, // Optional, defaults to https://cloud.langfuse.com
})

// Get system prompt from Langfuse
const systemPrompt = await langfuse.getPrompt('voice-assistant-system-prompt')

// Create OpenAI client and wrap with Langfuse observability
const openai = observeOpenAI(
  new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
  {
    sessionId: 'session-123',
    userId: 'user-456',
  }
)

// Create agent with Langfuse-wrapped OpenAI client
const agent = new OpenaiAgent({
  openai,
  model: 'gpt-4o',
  systemPrompt: systemPrompt.prompt,
})
```

This integration will automatically track all OpenAI API calls, token usage, and conversation flows in your Langfuse dashboard with session and user context.

## OpenAI STT (Speech-to-Text)

Real-time speech-to-text implementation using OpenAI's WebSocket-based real-time transcription API.

### Usage

```typescript
import { OpenaiSTT } from '@micdrop/openai'
import { MicdropServer } from '@micdrop/server'

const stt = new OpenaiSTT({
  apiKey: process.env.OPENAI_API_KEY || '',
  model: 'gpt-4o-transcribe', // Default real-time transcription model
  language: 'en', // Optional: specify language for better accuracy
  prompt: 'Transcribe the incoming audio in real time.', // Optional: custom prompt
  transcriptionTimeout: 4000, // Optional: timeout in ms for transcription
})

// Use with MicdropServer
new MicdropServer(socket, {
  stt,
  // ... other options
})
```

### Options

| Option                 | Type     | Default                                         | Description                                              |
| ---------------------- | -------- | ----------------------------------------------- | -------------------------------------------------------- |
| `apiKey`               | `string` | Required                                        | Your OpenAI API key                                      |
| `model`                | `string` | `'gpt-4o-transcribe'`                           | Real-time transcription model to use                     |
| `language`             | `string` | `'en'`                                          | Language code for transcription                          |
| `prompt`               | `string` | `'Transcribe the incoming audio in real time.'` | Custom prompt to guide transcription behavior            |
| `connectionTimeout`    | `number` | `5000`                                          | Timeout in milliseconds for WebSocket connection         |
| `transcriptionTimeout` | `number` | `4000`                                          | Timeout in milliseconds to wait for transcription result |
| `retryDelay`           | `number` | `1000`                                          | Delay in milliseconds between reconnection attempts      |
| `maxRetry`             | `number` | `3`                                             | Maximum number of reconnection attempts before failing   |

## OpenAI TTS (Text-to-Speech)

Text-to-speech implementation using OpenAI's speech API. The incoming text is buffered into sentences and each sentence is synthesized as soon as it is complete, so playback can start without waiting for the whole answer.

### Usage

```typescript
import { OpenaiTTS } from '@micdrop/openai'
import { MicdropServer } from '@micdrop/server'

const tts = new OpenaiTTS({
  apiKey: process.env.OPENAI_API_KEY || '',
  model: 'gpt-4o-mini-tts', // Default model
  voice: 'alloy', // Default voice

  // Prosody control, only for gpt-4o-mini-tts (optional)
  instructions: 'Speak in a calm and friendly tone',
})

// Use with MicdropServer
new MicdropServer(socket, {
  tts,
  // ... other options
})
```

### Options

| Option         | Type     | Default             | Description                                                          |
| -------------- | -------- | ------------------- | -------------------------------------------------------------------- |
| `apiKey`       | `string` | Required\*          | Your OpenAI API key (required if `openai` not provided)              |
| `openai`       | `OpenAI` | Optional            | OpenAI instance (alternative to `apiKey`)                            |
| `model`        | `string` | `'gpt-4o-mini-tts'` | Speech model to use (`gpt-4o-mini-tts`, `tts-1`, `tts-1-hd`)         |
| `voice`        | `string` | `'alloy'`           | Voice to use (e.g. `alloy`, `ash`, `ballad`, `coral`, `sage`, ...)   |
| `instructions` | `string` | `undefined`         | Prosody/accent/tone control. Only works with `gpt-4o-mini-tts`       |
| `speed`        | `number` | `undefined`         | Speech speed from `0.25` to `4.0`. Only works with `tts-1`/`tts-1-hd` |

:::note

**Language**: OpenAI's speech API has no language parameter, the voice follows the language of the input text. To influence the spoken language or accent, use `instructions` (e.g. `'Speak in French'`) with the `gpt-4o-mini-tts` model.

:::

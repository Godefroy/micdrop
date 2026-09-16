# @micdrop/gemini

[Micdrop website](https://micdrop.dev) | [Documentation](https://micdrop.dev/docs/ai-integration/provided-integrations/gemini)

Google Gemini implementation for [@micdrop/server](https://micdrop.dev/docs/server).

This package provides an agent (`GeminiAgent`), a speech-to-text (`GeminiSTT`) and a text-to-speech (`GeminiTTS`) running on the Gemini API. `GeminiLive` is a [realtime model](https://micdrop.dev/docs/server/realtime) running on the Gemini Live API: it hears the user and answers with its own voice, in place of the three.

## Installation

```bash
npm install @micdrop/gemini
```

## Gemini Agent, STT and TTS

```typescript
import { GeminiAgent, GeminiSTT, GeminiTTS } from '@micdrop/gemini'
import { MicdropServer } from '@micdrop/server'

const apiKey = process.env.GEMINI_API_KEY || ''

new MicdropServer(socket, {
  agent: new GeminiAgent({
    apiKey,
    model: 'gemini-3.8-flash', // Default model
    thinkingLevel: 'low', // Optional, the lower the sooner the first word
    systemPrompt: 'You are a helpful assistant',
  }),
  stt: new GeminiSTT({
    apiKey,
    model: 'gemini-3.5-transcribe-live', // Default model
    language: 'en-US', // Optional, detected when left out
  }),
  tts: new GeminiTTS({
    apiKey,
    model: 'gemini-2.5-flash-preview-tts', // Default model
    voice: 'Kore', // Default voice
  }),
})
```

Each one can be combined with the providers of other packages.

## Gemini Live

### Usage with MicdropServer

```typescript
import { GeminiLive } from '@micdrop/gemini'
import { MicdropServer } from '@micdrop/server'

const realtime = new GeminiLive({
  apiKey: process.env.GEMINI_API_KEY || '',
  model: 'gemini-3.8-live', // Default model
  systemPrompt: 'You are a helpful assistant',
  voice: 'Kore', // Optional, a prebuilt voice

  // Advanced features (optional)
  autoEndCall: true, // Automatically end call when user requests
})

new MicdropServer(socket, {
  realtime,
  generateFirstMessage: true,
})
```

The Micdrop client detects when the user speaks, so the automatic activity detection of Gemini is turned off. Tools are added with `addTool()` right after creating the model, since Gemini reads them when the session opens.

### Events

| Event                   | Payload                   | Description                                                            |
| ----------------------- | ------------------------- | ---------------------------------------------------------------------- |
| `Audio`                 | `Buffer`                  | A chunk of the voice of the model, PCM 16 bits, 16 kHz, mono.          |
| `PartialMessage`        | `string`                  | The transcript of the answer so far.                                   |
| `Message`               | `MicdropConversationItem` | A message, a tool call or a tool result was added to the conversation. |
| `ToolCall`              | `MicdropToolCall`         | A tool declared with `emitOutput` ran, with its parameters and output. |
| `CancelLastUserMessage` | none                      | The last user message was dropped because it carried no intent.        |
| `SkipAnswer`            | none                      | The model gave no spoken answer.                                       |
| `EndCall`               | none                      | The model decided that the call is over.                               |
| `Failed`                | none                      | The connection could not be restored after its retries.                |

`gemini-3.8-live-extended-thinking` reasons before answering and needs a `thinkingLevel`, such as `'low'`.

## Documentation

Read full [documentation of the Gemini integration for Micdrop](https://micdrop.dev/docs/ai-integration/provided-integrations/gemini) on the [website](https://micdrop.dev).

## License

MIT

## Author

Originally developed for [Raconte.ai](https://www.raconte.ai), created and open sourced by [Godefroy de Compreignac](https://github.com/Godefroy)

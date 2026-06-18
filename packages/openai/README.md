# @micdrop/openai

[Micdrop website](https://micdrop.dev) | [Documentation](https://micdrop.dev/docs/ai-integration/provided-integrations/openai)

OpenAI implementation for [@micdrop/server](https://micdrop.dev/docs/server).

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

## OpenAI STT (Speech-to-Text)

### Usage

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

## OpenAI TTS (Text-to-Speech)

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

  // Speech speed from 0.25 to 4.0, only for tts-1 / tts-1-hd (optional)
  // speed: 1,
})

// Use with MicdropServer
new MicdropServer(socket, {
  tts,
  // ... other options
})
```

> **Language**: OpenAI's speech API has no language parameter, the voice follows the language of the input text. To influence the spoken language or accent, use `instructions` (e.g. `'Speak in French'`) with the `gpt-4o-mini-tts` model.

## Documentation

Read full [documentation of the OpenAI integration for Micdrop](https://micdrop.dev/docs/ai-integration/provided-integrations/openai) on the [website](https://micdrop.dev).

## License

MIT

## Author

Originally developed for [Raconte.ai](https://www.raconte.ai) and open sourced by [Lonestone](https://www.lonestone.io) ([GitHub](https://github.com/lonestone))

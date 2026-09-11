# @micdrop/ai-sdk

[Micdrop website](https://micdrop.dev) | [Documentation](https://micdrop.dev/docs/ai-integration/provided-integrations/ai-sdk)

AI SDK implementation for [@micdrop/server](https://micdrop.dev/docs/server).

## Installation

Install AI SDK:

```bash
npm install @micdrop/ai-sdk
```

And install the provider you want to use, for example OpenAI:

```bash
npm install @ai-sdk/openai
```

## AI SDK Agent

### Usage with MicdropServer

```typescript
import { AiSdkAgent } from '@micdrop/ai-sdk'
import { MicdropServer } from '@micdrop/server'
import { openai } from '@ai-sdk/openai' // or any other provider

const agent = new AiSdkAgent({
  model: openai('gpt-4o'), // Use any AI SDK compatible model
  systemPrompt: 'You are a helpful assistant',

  // Advanced features (optional)
  autoEndCall: true, // Automatically end call when user requests
  autoSemanticTurn: true, // Handle incomplete sentences
  autoIgnoreUserNoise: true, // Filter out meaningless sounds

  // Custom AI SDK settings (optional)
  settings: {
    temperature: 0.7,
    maxOutputTokens: 150,
  },

  // Provider specific parameters (optional)
  providerOptions: {
    openai: { reasoningEffort: 'none' },
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
import { AiSdkAgent } from '@micdrop/ai-sdk'
import { openai } from '@ai-sdk/openai'

const agent = new AiSdkAgent({
  model: openai('gpt-4o'),
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

### Supported Providers

The AI SDK Agent supports any provider compatible with the Vercel AI SDK:

- **OpenAI**: `openai('gpt-4o')`, `openai('gpt-3.5-turbo')`
- **Anthropic**: `anthropic('claude-3-5-sonnet-20241022')`
- **Google**: `google('gemini-1.5-pro')`, `google('gemini-1.5-flash')`
- **Mistral**: `mistral('mistral-large-latest')`
- **And many more**: See [AI SDK Providers](https://sdk.vercel.ai/providers/ai-sdk-providers)

## Documentation

Read full [documentation of the AI SDK integration for Micdrop](https://micdrop.dev/docs/ai-integration/provided-integrations/ai-sdk) on the [website](https://micdrop.dev).

## License

MIT

## Author

Originally developed for [Raconte.ai](https://www.raconte.ai), created and open sourced by [Godefroy de Compreignac](https://github.com/Godefroy)

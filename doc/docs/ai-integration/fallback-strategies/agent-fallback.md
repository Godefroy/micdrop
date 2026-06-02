# FallbackAgent

The `FallbackAgent` class provides automatic failover between multiple LLM agents for improved reliability. When one agent fails to produce an answer after exhausting its retries, it automatically switches to the next agent in the list and lets it answer from the same conversation.

## Features

- **Automatic failover**: Seamlessly switches between agents when failures occur
- **Shared conversation**: The conversation history is shared between agents, so the next agent answers from the exact same context
- **Circular rotation**: Cycles through agents until one answers (one full rotation per answer)
- **Per-agent configuration**: Each agent keeps its own system prompt, tools and options
- **Event forwarding**: Forwards `Message`, `ToolCall`, `EndCall`, `SkipAnswer` and `CancelLastUserMessage` events from the active agent
- **Cancellation support**: Properly forwards `cancel()` calls to the active agent

## Usage

```typescript
import { FallbackAgent } from '@micdrop/server'
import { OpenaiAgent } from '@micdrop/openai'
import { MistralAgent } from '@micdrop/mistral'

const systemPrompt = 'You are a helpful assistant'

// Create a fallback agent with multiple providers
const agent = new FallbackAgent({
  factories: [
    // Primary provider: OpenAI with a low retry count
    () =>
      new OpenaiAgent({
        apiKey: process.env.OPENAI_API_KEY || '',
        systemPrompt,
        maxRetry: 2, // Fail faster to switch to backup
      }),
    // Backup provider: Mistral
    () =>
      new MistralAgent({
        apiKey: process.env.MISTRAL_API_KEY || '',
        systemPrompt,
        maxRetry: 3,
      }),
  ],
})

// Use with MicdropServer
const server = new MicdropServer(socket, {
  agent,
  // ... other options
})
```

## Options

| Option      | Type                 | Description                                              |
| ----------- | -------------------- | -------------------------------------------------------- |
| `factories` | `Array<() => Agent>` | Array of factory functions that create `Agent` instances |

## Configuration

Unlike a regular agent, `FallbackAgent` does not take a `systemPrompt` or tool options directly. Each child agent is fully configured inside its own factory function. This lets you tailor options (system prompt, tools, `autoEndCall`, `extract`, `onBeforeAnswer`, etc.) per provider.

To make providers behave consistently, give them the same `systemPrompt` and tools. You can also use slightly different prompts per provider if a given model needs specific instructions.

## How It Works

1. **Initialization**: Starts with the first agent in the list and adopts its conversation
2. **Normal operation**: Forwards the answer of the current agent and re-emits its events
3. **On failure**: When an agent emits the `Failed` event (after exhausting its retries):
   - Switches to the next agent (wraps around to the first if at the end)
   - Swaps in the new agent's system prompt while keeping the accumulated history
   - Lets the new agent answer from the shared conversation
   - Destroys the failed agent
4. **Giving up**: If every agent fails within a single answer (one full rotation), the answer is skipped
5. **Logging**: Inherits logger configuration and applies it to child agents

:::note
The fallback is triggered by the `Failed` event, which an agent emits once it has exhausted its own retries. Text already streamed before a failure may have been sent downstream, so failover is most seamless when an agent fails before producing any output (for example on a connection error).
:::

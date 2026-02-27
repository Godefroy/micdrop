# Agent (LLM)

The `Agent` class is the core abstraction for AI conversation handling in Micdrop. It provides a standardized interface for integrating various AI providers into real-time voice conversations.

## Available Implementations

- [OpenaiAgent](https://github.com/Godefroy/micdrop/blob/main/packages/openai/src/OpenaiAgent.ts) from [@micdrop/openai](../provided-integrations/openai)
- [MistralAgent](https://github.com/Godefroy/micdrop/blob/main/packages/mistral/src/MistralAgent.ts) from [@micdrop/mistral](../provided-integrations/mistral)
- [MockAgent](https://github.com/Godefroy/micdrop/blob/main/packages/server/src/agent/MockAgent.ts) for testing

## Overview

The `Agent` class is an abstract base class that extends `EventEmitter` (from `eventemitter3`) and manages:

- Conversation history with role-based messages (system, user, assistant)
- Streaming response generation with both stream and promise interfaces
- Event emission for conversation state changes
- Cancellation and cleanup mechanisms
- Integration with logging systems

```typescript
export abstract class Agent<
  Options extends AgentOptions = AgentOptions,
> extends EventEmitter<AgentEvents> {
  public logger?: Logger
  public conversation: MicdropConversation

  constructor(protected options: Options)

  // Generate a streaming response with both stream and promise interfaces
  answer(): Readable

  // Generate answer implementation (to be implemented by subclasses)
  protected abstract generateAnswer(stream: PassThrough): Promise<void>

  // Cancel the current answer generation process
  abstract cancel(): void
}
```

## Architecture

### Core Interfaces

```typescript
export interface AgentOptions {
  systemPrompt: string

  // Enable auto ending of the call when user asks to end the call
  // You can provide a custom prompt to use instead of the default one by passing a string
  autoEndCall?: boolean | string

  // Enable detection of an incomplete sentence, and skip the answer (assistant waits)
  // You can provide a custom prompt to use instead of the default one by passing a string
  autoSemanticTurn?: boolean | string

  // Ignore of the last user message when it's meaningless
  // You can provide a custom prompt to use instead of the default one by passing a string
  autoIgnoreUserNoise?: boolean | string

  // Extract a value from the answer
  // Value must be at the end of the answer, in JSON or between tags
  extract?: ExtractJsonOptions | ExtractTagOptions

  // Function called before any answer is generated
  // Return true to skip generation
  onBeforeAnswer?: (
    this: Agent,
    stream: Writable
  ) => void | boolean | Promise<boolean>
}

export interface AgentEvents {
  Message: [MicdropConversationMessage]
  CancelLastUserMessage: []
  SkipAnswer: []
  EndCall: []
  ToolCall: [MicdropToolCall]
}

export interface MicdropConversationMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  metadata?: any
}

export interface MicdropToolCall {
  name: string
  parameters: any
  output: any
}

export interface ExtractOptions {
  callback?: (value: string) => void
  saveInMetadata?: boolean
}

export interface ExtractJsonOptions extends ExtractOptions {
  json: true
  callback?: (value: any) => void
}

export interface ExtractTagOptions extends ExtractOptions {
  startTag: string
  endTag: string
}
```

### Conversation Management

The Agent maintains a conversation history as an array of messages:

```typescript
public conversation: MicdropConversation
```

The conversation is initialized with the system prompt:

```typescript
constructor(protected options: Options) {
  super()
  this.conversation = [{ role: 'system', content: options.systemPrompt }]
}
```

## Abstract Methods

### `generateAnswer(stream: PassThrough): Promise<void>`

Implementation method for generating answers. This is what subclasses should implement.

**Implementation Requirements:**

- Write response chunks to the provided stream
- Handle cancellation via the `cancel()` method
- Add the complete response to conversation history when finished with `addAssistantMessage()`
- Check cancellation state regularly during generation

### `cancel(): void`

Cancels the current answer generation process. Should:

- Abort any ongoing API requests
- Clean up resources
- Stop the answer stream

## Public Methods

### `answer(): Readable`

Generates a streaming response based on the current conversation history.

**Return Value:** A `Readable` stream that emits text chunks in real-time

**Behavior:**

- Calls `onBeforeAnswer` hook if provided
- If hook returns `true`, skips answer generation
- Otherwise calls `generateAnswer()` implementation
- Handles cancellation and cleanup automatically

### `addMessage(role: 'user' | 'assistant' | 'system', text: string, metadata?: MicdropAnswerMetadata)`

Add any type of message with content to the conversation and emit the `Message` event.

```typescript
agent.addMessage('assistant', 'Hello there!')
```

### `addUserMessage(text: string, metadata?: MicdropAnswerMetadata)`

Adds a user message to the conversation history and emits a `Message` event.

```typescript
agent.addUserMessage('Hello, how are you?')
```

### `addAssistantMessage(text: string, metadata?: MicdropAnswerMetadata)`

Adds an assistant message to the conversation history and emits a `Message` event.

```typescript
agent.addAssistantMessage("I'm doing well, thank you!")
```

### `addTool<Schema extends z.ZodObject>(tool: Tool<Schema>)`

Adds a custom tool to the agent's available tools.

```typescript
import { z } from 'zod'

const weatherTool = {
  name: 'get_weather',
  description: 'Get current weather for a location',
  parameters: z.object({
    location: z.string().describe('The city name'),
  }),
  execute: async ({ location }) => {
    // Fetch weather data
    return { temperature: 22, conditions: 'sunny' }
  },
}

agent.addTool(weatherTool)
```

### `removeTool(name: string)`

Removes a tool from the agent's available tools by name.

```typescript
agent.removeTool('get_weather')
```

### `getTool(name: string): Tool | undefined`

Retrieves a tool by name from the agent's available tools.

```typescript
const tool = agent.getTool('get_weather')
if (tool) {
  console.log('Weather tool is available')
}
```

### `addToolMessage(message: MicdropConversationToolCall | MicdropConversationToolResult)`

Adds a tool call or tool result message to the conversation.

```typescript
// Add tool call
agent.addToolMessage({
  role: 'tool_call',
  toolCallId: 'call_123',
  toolName: 'get_weather',
  parameters: JSON.stringify({ location: 'Paris' }),
})

// Add tool result
agent.addToolMessage({
  role: 'tool_result',
  toolCallId: 'call_123',
  toolName: 'get_weather',
  output: JSON.stringify({ temperature: 22, conditions: 'sunny' }),
})
```

### `extract(message: string): { message: string; metadata?: MicdropAnswerMetadata }`

Extracts structured data from a message based on the configured extraction options. Returns the cleaned message and any extracted metadata.

```typescript
// With JSON extraction
const result = agent.extract('The answer is 42. {"score":42}')
// Returns: { message: 'The answer is 42.', metadata: { extracted: { score: 42 } } }

// With tag extraction
const result = agent.extract('The answer is 42. <score>42</score>')
// Returns: { message: 'The answer is 42.', metadata: { extracted: '42' } }
```

It is called automatically when the `extract` option is provided. It is public so that you can use it to extract data from the answer before adding it to the conversation, if you really need to.

### `destroy()`

Cleans up the agent instance:

- Removes all event listeners
- Calls `cancel()` to stop ongoing operations
- Logs destruction

```typescript
agent.destroy()
```

## Protected Methods

### `endCall()`

Emits the `EndCall` event to signal that the conversation should end.

### `cancelLastUserMessage()`

Removes the last user message from the conversation history (if it exists) and emits the `CancelLastUserMessage` event.

### `skipAnswer()`

Emits the `SkipAnswer` event to indicate the agent is skipping the current response.

### `getDefaultTools(): Tool[]`

Returns the default tools based on the agent's configuration options (`autoEndCall`, `autoSemanticTurn`, `autoIgnoreUserNoise`).

### `executeTool(toolCall: MicdropConversationToolCall): Promise<{ output: any; skipAnswer?: boolean }>`

Executes a tool call and handles the result. This method:

- Finds the tool by name
- Adds the tool call to conversation history
- Executes the tool with the provided parameters
- Adds the tool result to conversation history
- Emits a `ToolCall` event if the tool has `emitOutput: true`
- Returns the output and whether to skip the answer

### `getExtractOptions(): ExtractTagOptions | undefined`

Returns the extraction options configured for the agent, converting JSON extraction to tag-based extraction.

### `log(...message: any[])`

Logs messages using the attached logger if available.

```typescript
agent.log('Processing user message:', userInput)
```

## Protected Properties

### `tools: Tool[]`

Array of available tools that the agent can use.

### `answerCount: number`

Counter used for cancellation handling. Incremented each time `answer()` is called.

### `answering: boolean`

Flag indicating whether the agent is currently generating an answer.

### `options: Options`

The configuration options passed to the agent constructor.

## Events

The Agent emits the following events:

### `Message`

Emitted when a new message is added to the conversation.

```typescript
agent.on('Message', (message: MicdropConversationMessage) => {
  console.log(`New ${message.role} message: ${message.content}`)
})
```

### `CancelLastUserMessage`

Emitted when the last user message is cancelled.

```typescript
agent.on('CancelLastUserMessage', () => {
  console.log('Last user message was cancelled')
})
```

### `SkipAnswer`

Emitted when the agent decides to skip answering.

```typescript
agent.on('SkipAnswer', () => {
  console.log('Agent skipped answering')
})
```

### `EndCall`

Emitted when the agent determines the call should end.

```typescript
agent.on('EndCall', () => {
  console.log('Call should end')
})
```

## Debug Logging

Enable detailed logging for development:

```typescript
import { Logger } from '@micdrop/server'

agent.logger = new Logger('CustomAgent')
```

## Custom Agent Implementation

### Creating a Custom Agent Implementation

```typescript
import { Agent, AgentOptions } from '@micdrop/server'
import { PassThrough, Writable } from 'stream'

interface CustomAgentOptions extends AgentOptions {
  apiKey: string
  model?: string
  settings?: any // Provider-specific settings
}

const DEFAULT_MODEL = 'gpt-4'

class CustomAgent extends Agent<CustomAgentOptions> {
  constructor(options: CustomAgentOptions) {
    super(options)
  }

  protected async generateAnswer(stream: PassThrough): Promise<void> {
    const answerCount = this.answerCount

    try {
      // Build messages for your AI provider
      const messages = this.conversation.map((msg) => ({
        role: msg.role,
        content: msg.content,
      }))

      // Make API call to your AI provider
      const response = await fetch('https://api.your-provider.com/chat', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages,
          model: this.options.model || DEFAULT_MODEL,
          stream: true,
          ...this.options.settings,
        }),
      })

      if (!response.ok) {
        throw new Error(`API request failed: ${response.statusText}`)
      }

      const reader = response.body?.getReader()
      let fullResponse = ''

      while (reader) {
        // Check if this answer was cancelled
        if (answerCount !== this.answerCount) return

        const { done, value } = await reader.read()
        if (done) break

        // Parse streaming response (format depends on your provider)
        const chunk = new TextDecoder().decode(value)

        if (chunk) {
          this.log(`Answer chunk: "${chunk}"`)
          stream.write(chunk)
          fullResponse += chunk
        }
      }

      // Only add to conversation if this answer wasn't cancelled
      if (answerCount === this.answerCount) {
        this.addAssistantMessage(fullResponse)
      }
    } catch (error: any) {
      console.error('[CustomAgent] Error:', error)
    }
  }

  cancel(): void {
    if (!this.answering) return
    this.log('Cancel')

    // Increment answer count to cancel current generation
    this.answerCount++
  }
}
```

### Using Custom Agent with MicdropServer

```typescript
// Create custom agent
const agent = new CustomAgent({
  apiKey: process.env.YOUR_API_KEY || '',
  systemPrompt: 'You are a helpful assistant.',
  model: 'your-model-name',
})

// Add logging
agent.logger = new Logger('CustomAgent')

// Setup event handlers
agent.on('Message', (message) => {
  console.log(`${message.role}: ${message.content}`)
})

// Create server with custom agent
new MicdropServer(socket, {
  agent,
  // ...other options
})
```

### Simple Echo Agent Example

```typescript
import { Agent, MicdropConversationMessage } from '@micdrop/server'
import { PassThrough } from 'stream'

class EchoAgent extends Agent {
  protected async generateAnswer(stream: PassThrough): Promise<void> {
    // Get the last user message
    const lastUserMessage = this.conversation
      .filter((msg) => msg.role === 'user')
      .pop() as MicdropConversationMessage

    if (lastUserMessage) {
      // Simulate a delay before responding
      await new Promise((resolve) => setTimeout(resolve, 100))

      const response = `You said: "${lastUserMessage.content}"`

      // Stream the response
      stream.write(response)

      // Add to conversation
      this.addAssistantMessage(response)
    }
  }

  cancel(): void {
    // Nothing to cancel for this simple implementation
  }
}

// Usage
const echoAgent = new EchoAgent({
  systemPrompt: 'You are an echo agent that repeats what users say.',
})

echoAgent.addUserMessage('Hello!')
const stream = echoAgent.answer()

stream.on('data', (chunk) => {
  console.log('Chunk:', chunk.toString())
})

stream.on('end', async () => {
  console.log('Stream ended')
  echoAgent.destroy()
})
```

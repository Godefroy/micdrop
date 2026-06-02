# Tools

The Agent system supports adding and removing custom tools to extend its capabilities.

## Adding Tools

Use `addTool(tool: Tool)` to add custom functions that the agent can call during conversations:

```typescript
import { z } from 'zod'
import { OpenaiAgent } from '@micdrop/openai'
import { MicdropServer } from '@micdrop/server'

const agent = new OpenaiAgent({
  apiKey: process.env.OPENAI_API_KEY || '',
  systemPrompt: 'You are a helpful assistant that can manage user information.',
})

// Add a simple tool without parameters
agent.addTool({
  name: 'get_time',
  description: 'Get the current time',
  execute: () => new Date().toLocaleTimeString(),
})

// Add a tool with typed parameters using Zod schema
agent.addTool({
  name: 'set_user_info',
  description: 'Save user information to the database',
  inputSchema: z.object({
    city: z.string().describe('City'),
    jobTitle: z.string().describe('Job title').nullable(),
    experience: z
      .number()
      .describe('Number of years of experience of the user')
      .nullable(),
  }),
  execute: ({ city, jobTitle, experience }) => {
    // Your implementation here
    console.log('Saving user:', { city, jobTitle, experience })
    return { success: true, message: 'User information saved' }
  },
})

// Add a tool that returns data for the conversation
agent.addTool({
  name: 'search_database',
  description: 'Search for items in the database',
  parameters: z.object({
    query: z.string().describe('Search query'),
    limit: z.number().default(10).describe('Maximum number of results'),
  }),
  execute: async ({ query, limit }) => {
    // Your search implementation
    const results = await searchDatabase(query, limit)
    return { results, total: results.length }
  },
  emitOutput: true, // Enable tool call events
})

// Add a tool that can interact with the server (e.g., delayed responses)
function addTools(server: MicdropServer, agent: OpenaiAgent) {
  agent.addTool({
    name: 'say_something_later',
    description:
      'Say something later (can be used as an alarm clock or reminder)',
    inputSchema: z.object({
      message: z.string().describe('The message to say'),
      delay: z.number().describe('The delay in seconds'),
    }),
    execute: async ({ message, delay }) => {
      setTimeout(() => {
        agent.addAssistantMessage(message)
        server.speak(message)
      }, delay * 1000)
      return { success: true }
    },
  })
}
```

## Tool Options

| Option        | Type                             | Default  | Description                             |
| ------------- | -------------------------------- | -------- | --------------------------------------- |
| `name`        | `string`                         | Required | Unique name for the tool                |
| `description` | `string`                         | Required | Description of what the tool does       |
| `inputSchema` | `z.ZodObject`                    | Optional | Zod schema for parameter validation     |
| `execute`     | `(input, agent) => any \| Promise<any>` | Required | Function to execute when tool is called |
| `skipAnswer`  | `boolean`                        | `false`  | Skip assistant response after tool call |
| `emitOutput`  | `boolean`                        | `false`  | Emit ToolCall events for monitoring     |

:::tip

If `emitOutput` is true, the tool call output is also sent to the client and available with the `ToolCall` event.

:::

## The `agent` context

The `execute` function receives the executing agent as a second argument. Use it instead of capturing a specific agent in a closure, so tools stay portable and can be shared between agents (this is what lets [FallbackAgent](../ai-integration/fallback-strategies/agent-fallback) hand the same tools to every provider it switches to):

```typescript
agent.addTool({
  name: 'count_messages',
  description: 'Count the messages exchanged so far',
  execute: (input, agent) => ({ count: agent.conversation.length }),
})
```

The first `input` argument is always present; the `agent` argument is optional, so simple tools can keep ignoring it. The built-in `autoEndCall`, `autoSemanticTurn` and `autoIgnoreUserNoise` tools use this same mechanism internally.

## Removing Tools

Use `removeTool(name: string)` to remove tools by name:

```typescript
// Remove a specific tool
agent.removeTool('get_time')
```

## Getting Tools

Use `getTool(name: string)` to retrieve a tool by name:

```typescript
// Get a specific tool (undefined if not found)
const tool = agent.getTool('get_time')
```

## Tool Call Events

Monitor tool executions in real-time by enabling the `emitOutput` option and listening for `ToolCall` events:

```typescript
import { OpenaiAgent } from '@micdrop/openai'

const agent = new OpenaiAgent({
  apiKey: process.env.OPENAI_API_KEY || '',
  systemPrompt: 'You are a helpful assistant with access to tools.',
})

// Add tool with emitOutput enabled
agent.addTool({
  name: 'save_user_data',
  description: 'Save user data to the system',
  inputSchema: z.object({
    name: z.string(),
    email: z.string().email(),
  }),
  emitOutput: true, // Enable events for this tool
})

// Listen for tool call event
agent.on('ToolCall', (toolCall) => {
  console.log(`Tool called: ${toolCall.name}`)
  console.log('Parameters:', toolCall.parameters)
  console.log('Output:', toolCall.output)

  if (toolCall.name === 'save_user_data') {
    // Sync data to external systems
    syncToDatabase(toolCall.output)
  }
})
```

:::tip

It may be easier and safer to use tool `execute` option if you don't need to emit the output to the client.

:::

## Tool Call Event Structure

The `ToolCall` event provides complete information about tool execution:

```typescript
interface ToolCall {
  name: string // Tool name that was called
  parameters: any // Parameters passed to the tool
  output: any // Result returned by the tool execute function
}
```

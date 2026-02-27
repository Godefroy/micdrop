import { Agent, AgentOptions } from '@micdrop/server'
import { Mistral } from '@mistralai/mistralai'
import {
  ChatCompletionStreamRequest,
  ChatCompletionStreamRequestMessages,
} from '@mistralai/mistralai/models/components'
import { Writable } from 'stream'
import z, { toJSONSchema } from 'zod'

export interface MistralAgentOptions extends AgentOptions {
  apiKey: string
  model?: string
  settings?: Omit<ChatCompletionStreamRequest, 'messages' | 'model'>
  maxRetry?: number
  retryDelay?: number
  maxSteps?: number
}

const DEFAULT_MODEL = 'mistral-large-latest'
const DEFAULT_MAX_RETRY = 3
const DEFAULT_MAX_STEPS = 5
const DEFAULT_RETRY_DELAY = 500

export class MistralAgent extends Agent<MistralAgentOptions> {
  private mistral: Mistral

  constructor(options: MistralAgentOptions) {
    super(options)
    this.mistral = new Mistral({ apiKey: options.apiKey })
  }

  protected async generateAnswer(
    stream: Writable,
    stepCount = 0,
    tryCount = 0
  ) {
    if (stepCount >= (this.options.maxSteps || DEFAULT_MAX_STEPS)) {
      console.error('[MistralAgent] Max steps reached')
      return
    }

    const answerCount = this.answerCount

    // Hack: Mistral needs a user message if there is only a system message
    if (this.conversation.length === 1) {
      this.conversation.push({
        role: 'user',
        content: '',
      })
    }

    // Prepare extracting
    let extracting = false
    const extractOptions = this.getExtractOptions()

    try {
      const result = await this.mistral.chat.stream({
        model: this.options.model || DEFAULT_MODEL,
        messages: this.buildMessages(),
        tools: this.buildTools(),
        ...this.options.settings,
      })
      let fullAnswer = ''
      let skipAnswer = false

      // Handle response events
      for await (const event of result) {
        if (answerCount !== this.answerCount) return
        const delta = event.data.choices[0]?.delta
        const chunk = delta?.content
        const toolCalls = delta?.toolCalls

        // Text chunk
        if (typeof chunk === 'string') {
          if (chunk === '') continue
          this.log(`Answer chunk: "${chunk}"`)
          fullAnswer += chunk

          // Extracting value?
          if (extractOptions) {
            if (!extracting) {
              const startTagIndex = fullAnswer.indexOf(extractOptions.startTag)
              if (startTagIndex !== -1) {
                extracting = true
                const messagePart = fullAnswer.slice(0, startTagIndex).trimEnd()
                stream.write(messagePart)
                continue
              }
            } else {
              // Extracting, don't write to stream
              continue
            }
          }
          stream.write(chunk)
        } else if (toolCalls?.length) {
          for (const toolCall of toolCalls) {
            const result = await this.executeTool({
              role: 'tool_call',
              toolCallId: toolCall.id || '',
              toolName: toolCall.function.name,
              parameters: toolCall.function.arguments as string,
            })
            if (result.skipAnswer) {
              skipAnswer = true
            }
          }
        }
      }

      if (answerCount !== this.answerCount) return

      if (fullAnswer) {
        // Add full answer to conversation
        const { message, metadata } = this.extract(fullAnswer)
        this.addAssistantMessage(message, metadata)
      } else if (skipAnswer) {
        // Hack: Mistral needs an assistant message after tool calls
        this.conversation.push({
          role: 'assistant',
          content: ' ',
        })
      } else {
        // Query again in case of tool call
        await this.generateAnswer(stream, stepCount + 1)
      }
    } catch (error: any) {
      console.error('[MistralAgent] Error:', error)
      if (tryCount < (this.options.maxRetry || DEFAULT_MAX_RETRY)) {
        await new Promise((resolve) =>
          setTimeout(resolve, this.options.retryDelay || DEFAULT_RETRY_DELAY)
        )
        await this.generateAnswer(stream, stepCount, tryCount + 1)
      }
    }
  }

  private buildMessages(): ChatCompletionStreamRequestMessages[] {
    return this.conversation.map(
      (message): ChatCompletionStreamRequestMessages => {
        switch (message.role) {
          case 'user':
          case 'assistant':
          case 'system':
            return {
              role: message.role,
              content: message.content,
            }
          case 'tool_call':
            return {
              role: 'assistant',
              toolCalls: [
                {
                  type: 'function',
                  id: message.toolCallId,
                  function: {
                    name: message.toolName,
                    arguments: JSON.stringify(message.parameters),
                  },
                },
              ],
            }
          case 'tool_result':
            return {
              role: 'tool',
              toolCallId: message.toolCallId,
              name: message.toolName,
              content: [
                {
                  type: 'text',
                  text: message.output,
                },
              ],
            }
        }
      }
    )
  }

  private buildTools(): ChatCompletionStreamRequest['tools'] {
    // Disable tools if first message
    const enableTools = this.conversation.length > 1
    if (!enableTools) return undefined

    return this.tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: toJSONSchema(tool.inputSchema || z.object()),
      },
    }))
  }

  cancel() {
    if (!this.answering) return
    this.log('Cancel')
    this.answering = false

    // Increment counter to avoid processing messages from previous calls
    this.answerCount++
  }
}

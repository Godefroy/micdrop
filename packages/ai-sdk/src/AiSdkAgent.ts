import { ProviderOptions } from '@ai-sdk/provider-utils'
import { Agent, AgentOptions } from '@micdrop/server'
import {
  CallSettings,
  LanguageModel,
  ModelMessage,
  stepCountIs,
  streamText,
  tool,
  ToolSet,
} from 'ai'
import { PassThrough } from 'stream'
import { z } from 'zod'

export interface AiSdkAgentOptions extends AgentOptions {
  model: LanguageModel
  settings?: CallSettings
  /**
   * Parameters read by a single provider, keyed by provider name, for anything
   * `settings` has no field for. `{ openai: { reasoningEffort: 'none' } }`
   * turns reasoning off, which a spoken turn needs.
   */
  providerOptions?: ProviderOptions
  maxRetry?: number
}

const DEFAULT_MAX_RETRY = 3

const FIRST_MESSAGE_PROMPT = 'The call starts now.'

export class AiSdkAgent extends Agent<AiSdkAgentOptions> {
  protected async generateAnswer(
    stream: PassThrough,
    signal: AbortSignal
  ): Promise<void> {
    let skipAnswer = false

    // Prepare extracting
    let extracting = false
    const extractOptions = this.getExtractOptions()

    try {
      // Generate response using AI SDK
      const result = streamText({
        model: this.options.model,
        instructions: this.buildInstructions(),
        messages: this.buildMessages(),
        tools: this.buildTools(),
        maxRetries: this.options.maxRetry ?? DEFAULT_MAX_RETRY,
        providerOptions: this.options.providerOptions,
        stopWhen: stepCountIs(5),
        onStepFinish: (step) => {
          const tools = step.toolCalls.map((toolCall) =>
            this.getTool(toolCall.toolName)
          )
          if (tools.some((t) => t?.skipAnswer)) {
            skipAnswer = true
          }
        },
        ...this.options.settings,
        abortSignal: signal,
      })

      for await (const textPart of result.textStream) {
        if (skipAnswer || signal.aborted) return
        this.log(`Answer chunk: "${textPart}"`)

        // Extracting value?
        if (extractOptions) {
          if (!extracting) {
            const startTagIndex = textPart.indexOf(extractOptions.startTag)
            if (startTagIndex !== -1) {
              extracting = true
              const messagePart = textPart.slice(0, startTagIndex).trimEnd()
              stream.write(messagePart)
              continue
            }
          } else {
            // Extracting, don't write to stream
            continue
          }
        }

        // Send chunk
        stream.write(textPart)
      }
      if (skipAnswer || signal.aborted) return

      const fullText = await result.text
      // A cancelled answer was never heard in full, it stays out of the
      // conversation
      if (signal.aborted) return
      const { message, metadata } = this.extract(fullText)

      // Emit message
      this.addAssistantMessage(message, metadata)
    } catch (error: any) {
      // An aborted request throws too, but that is the cancellation the base
      // asked for, not a failure to report
      if (!signal.aborted) {
        console.error('[AiSdkAgent] Error answering:', error)
        this.log('Generation failed, giving up')
        this.emit('Failed')
      }
    }
  }

  // The AI SDK takes the system prompt apart from the conversation
  private buildInstructions() {
    return this.conversation
      .flatMap((message) => (message.role === 'system' ? message.content : []))
      .join('\n\n')
  }

  private buildMessages(): ModelMessage[] {
    const messages = this.conversation.flatMap((message): ModelMessage | [] => {
      switch (message.role) {
        case 'system':
          return []
        case 'user':
        case 'assistant':
          return {
            role: message.role,
            content: message.content,
          }
        case 'tool_call':
          return {
            role: 'assistant',
            content: [
              {
                type: 'tool-call',
                toolCallId: message.toolCallId,
                toolName: message.toolName,
                input: JSON.parse(message.parameters),
              },
            ],
          }
        case 'tool_result':
          return {
            role: 'tool',
            content: [
              {
                type: 'tool-result',
                toolCallId: message.toolCallId,
                toolName: message.toolName,
                output: {
                  type: 'json',
                  value: JSON.parse(message.output),
                },
              },
            ],
          }
      }
    })

    // Asked for the opening line, with nothing said yet: the SDK refuses a
    // prompt without a message, and the model needs something to answer to
    if (messages.length === 0) {
      messages.push({ role: 'user', content: FIRST_MESSAGE_PROMPT })
    }
    return messages
  }

  private buildTools() {
    const tools: ToolSet = {}

    // Disable tools if first message
    const enableTools = this.conversation.length > 1
    if (!enableTools) return tools

    this.tools.forEach((t) => {
      tools[t.name] = tool({
        description: t.description,
        inputSchema: (t.inputSchema || z.object({})) as z.ZodObject,
        execute: (args: any, { toolCallId }: { toolCallId: string }) =>
          this.executeTool({
            role: 'tool_call',
            toolCallId,
            toolName: t.name,
            parameters: JSON.stringify(args),
          }),
      })
    })
    return tools
  }
}

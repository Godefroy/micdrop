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
  maxRetry?: number
}

const DEFAULT_MAX_RETRY = 3

export class AiSdkAgent extends Agent<AiSdkAgentOptions> {
  private abortController?: AbortController

  protected async generateAnswer(stream: PassThrough): Promise<void> {
    const abortController = new AbortController()
    this.abortController = abortController
    const signal = this.abortController.signal
    let skipAnswer = false

    // Prepare extracting
    let extracting = false
    const extractOptions = this.getExtractOptions()

    try {
      // Generate response using AI SDK
      const result = streamText({
        model: this.options.model,
        messages: this.buildMessages(),
        tools: this.buildTools(),
        maxRetries: this.options.maxRetry ?? DEFAULT_MAX_RETRY,
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
        if (skipAnswer) return
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
      if (skipAnswer) return

      const fullText = await result.text
      const { message, metadata } = this.extract(fullText)

      // Emit message
      this.addAssistantMessage(message, metadata)
      this.abortController = undefined
    } catch (error: any) {
      if (abortController === this.abortController) {
        console.error('[AiSdkAgent] Error answering:', error)
      }
    }
  }

  private buildMessages(): ModelMessage[] {
    return this.conversation.map((message): ModelMessage => {
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

  cancel() {
    if (!this.abortController) return
    this.log('Cancel')
    this.abortController.abort()
    this.abortController = undefined
  }
}

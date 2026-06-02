import { Agent, AgentOptions } from '@micdrop/server'
import OpenAI from 'openai'
import { PassThrough } from 'stream'
import z, { toJSONSchema } from 'zod'

export type OpenaiAgentOptions = AgentOptions &
  OpenaiOptions & {
    model?: string
    settings?: Omit<
      OpenAI.Responses.ResponseCreateParamsStreaming,
      'input' | 'model' | 'tools' | 'stream'
    >
    retryDelay?: number
    maxRetry?: number
    maxSteps?: number
  }

export type OpenaiOptions = { apiKey: string } | { openai: OpenAI }

const DEFAULT_MODEL = 'gpt-4o'
const DEFAULT_MAX_STEPS = 5
const DEFAULT_MAX_RETRIES = 3
const DEFAULT_RETRY_DELAY = 1000

export class OpenaiAgent extends Agent<OpenaiAgentOptions> {
  private openai: OpenAI
  private abortController?: AbortController

  constructor(options: OpenaiAgentOptions) {
    super(options)
    this.openai =
      'openai' in options
        ? options.openai
        : new OpenAI({ apiKey: options.apiKey })
  }

  protected async generateAnswer(
    stream: PassThrough,
    stepCount = 0,
    tryCount = 0
  ): Promise<void> {
    if (stepCount >= (this.options.maxSteps || DEFAULT_MAX_STEPS)) {
      console.error('[OpenaiAgent] Max steps reached')
      return
    }

    const abortController = new AbortController()
    this.abortController = abortController
    const signal = abortController.signal

    // Prepare extracting
    let extracting = false
    const extractOptions = this.getExtractOptions()

    try {
      // Generate answer
      const response = await this.openai.responses.create(
        {
          model: this.options.model || DEFAULT_MODEL,
          input: this.buildInput(),
          tools: this.buildTools(),
          stream: true,
          ...this.options.settings,
        },
        { signal }
      )
      let skipAnswer = false

      // Handle response events
      for await (const event of response) {
        if (abortController !== this.abortController) return
        switch (event.type) {
          case 'response.output_text.delta':
            this.log(`Answer chunk: "${event.delta}"`)

            // Extracting value?
            if (extractOptions) {
              if (!extracting) {
                const startTagIndex = event.delta.indexOf(
                  extractOptions.startTag
                )
                if (startTagIndex !== -1) {
                  extracting = true
                  const messagePart = event.delta
                    .slice(0, startTagIndex)
                    .trimEnd()
                  stream.write(messagePart)
                  break
                }
              } else {
                // Extracting, don't write to stream
                break
              }
            }

            // Send chunk
            stream.write(event.delta)
            break

          case 'response.output_text.done':
            const { message, metadata } = this.extract(event.text)
            this.addAssistantMessage(message, metadata)
            this.abortController = undefined
            // Stop query now that we have a complete answer
            // Note: OpenAI can sometimes return multiple outputs.
            // See https://community.openai.com/t/how-to-prevent-the-api-returning-multiple-outputs/1251365/28
            // We can prompt it like this to avoid consuming too many tokens:
            // `Return one complete answer and then stop`
            return

          case 'response.output_item.done':
            if (event.item.type === 'function_call') {
              const toolCall = event.item
              const result = await this.executeTool({
                role: 'tool_call',
                toolCallId: toolCall.call_id,
                toolName: toolCall.name,
                parameters: toolCall.arguments,
              })
              if (result.skipAnswer) {
                skipAnswer = true
              }
            }
            break

          default:
            break
        }
      }

      if (abortController !== this.abortController) return

      // Query again in case of tool call
      if (!skipAnswer) {
        await this.generateAnswer(stream, stepCount + 1)
      }
      this.abortController = undefined
    } catch (error) {
      if (error instanceof OpenAI.APIUserAbortError) return
      console.error('[OpenaiAgent] Error answering:', error)

      if (tryCount < (this.options.maxRetry ?? DEFAULT_MAX_RETRIES)) {
        await new Promise((resolve) =>
          setTimeout(resolve, this.options.retryDelay ?? DEFAULT_RETRY_DELAY)
        )
        await this.generateAnswer(stream, stepCount, tryCount + 1)
      } else {
        this.log('Max retries reached, giving up')
        this.emit('Failed')
      }
    }
  }

  private buildInput(): OpenAI.Responses.ResponseInput {
    return this.conversation.map((message) => {
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
            type: 'function_call',
            call_id: message.toolCallId,
            name: message.toolName,
            arguments: JSON.stringify(message.parameters),
          }
        case 'tool_result':
          return {
            type: 'function_call_output',
            call_id: message.toolCallId,
            output: message.output,
          }
      }
    })
  }

  private buildTools(): OpenAI.Responses.Tool[] | undefined {
    // Disable tools if first message
    const enableTools = this.conversation.length > 1
    if (!enableTools) return undefined

    return this.tools.map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      strict: true,
      parameters: toJSONSchema(tool.inputSchema || z.object()),
    }))
  }

  cancel() {
    if (!this.abortController) return
    this.log('Cancel')
    this.abortController.abort()
    this.abortController = undefined
  }
}

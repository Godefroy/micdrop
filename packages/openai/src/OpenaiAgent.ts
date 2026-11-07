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

/** What one request produced */
interface StepOutcome {
  // Text written to the stream, before extraction
  text: string
  // The answer was complete and is already in the conversation
  recorded: boolean
  skipAnswer: boolean
}

/** A request that failed after writing text or running tools */
class StepInterruptedError extends Error {
  constructor(
    readonly outcome: StepOutcome,
    readonly reason: unknown
  ) {
    super('Answer interrupted')
  }
}

export class OpenaiAgent extends Agent<OpenaiAgentOptions> {
  private openai: OpenAI

  constructor(options: OpenaiAgentOptions) {
    super(options)
    this.openai =
      'openai' in options
        ? options.openai
        : new OpenAI({ apiKey: options.apiKey })
  }

  protected async generateAnswer(
    stream: PassThrough,
    signal: AbortSignal
  ): Promise<void> {
    const maxSteps = this.options.maxSteps || DEFAULT_MAX_STEPS
    const maxRetry = this.options.maxRetry ?? DEFAULT_MAX_RETRIES

    // Each step is one request. A step that only calls tools asks for another
    // one, so the model can answer with their results.
    for (let step = 0; step < maxSteps; step++) {
      let outcome: StepOutcome | undefined
      for (let tryCount = 0; !outcome; tryCount++) {
        try {
          outcome = await this.generateStep(stream, signal)
        } catch (error) {
          // An aborted request throws too, but that is the cancellation the
          // base asked for, not a failure to report
          if (signal.aborted) return
          if (error instanceof StepInterruptedError) {
            // Text already reached the stream or tools already ran: a retry
            // would say or do it again, so the step keeps what it got
            console.error('[OpenaiAgent] Answer interrupted:', error.reason)
            outcome = error.outcome
            break
          }
          console.error('[OpenaiAgent] Error answering:', error)
          if (tryCount >= maxRetry) {
            this.log('Max retries reached, giving up')
            this.emit('Failed')
            return
          }
          await new Promise((resolve) =>
            setTimeout(resolve, this.options.retryDelay ?? DEFAULT_RETRY_DELAY)
          )
          // Cancelled during the delay: the retry would answer nobody
          if (signal.aborted) return
        }
      }
      if (signal.aborted) return

      if (outcome.recorded || outcome.skipAnswer) return
      if (outcome.text) {
        // Interrupted mid answer: what the user heard goes in the conversation
        const { message, metadata } = this.extract(outcome.text)
        this.addAssistantMessage(message, metadata)
        return
      }
      // Query again when the model called a tool without answering, so the
      // turn still produces something to say
    }
    console.error('[OpenaiAgent] Max steps reached')
  }

  /**
   * Runs one request, writing its text to the stream and running its tools.
   *
   * It throws the error of the request when it failed before producing
   * anything, which can then be retried, and a {@link StepInterruptedError}
   * once something was written or done.
   */
  private async generateStep(
    stream: PassThrough,
    signal: AbortSignal
  ): Promise<StepOutcome> {
    const outcome: StepOutcome = {
      text: '',
      recorded: false,
      skipAnswer: false,
    }
    let produced = false

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

      // Handle response events
      for await (const event of response) {
        if (signal.aborted) return outcome
        switch (event.type) {
          case 'response.output_text.delta':
            // Ignore extra outputs, we keep the first answer only
            if (outcome.recorded) break

            this.log(`Answer chunk: "${event.delta}"`)
            outcome.text += event.delta
            produced = true

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

          case 'response.output_text.done': {
            // Keep the first answer only.
            // Note: OpenAI can sometimes return multiple outputs.
            // See https://community.openai.com/t/how-to-prevent-the-api-returning-multiple-outputs/1251365/28
            // We can prompt it like this to avoid consuming too many tokens:
            // `Return one complete answer and then stop`
            if (outcome.recorded) break

            const { message, metadata } = this.extract(event.text)
            this.addAssistantMessage(message, metadata)
            outcome.recorded = true
            // Keep reading events instead of returning here: the API streams
            // one output item at a time, so a function call the model made
            // alongside its answer is only announced after the text is done.
            // Returning dropped every tool call that came with an answer.
            break
          }

          case 'response.output_item.done':
            if (event.item.type === 'function_call') {
              const toolCall = event.item
              produced = true
              const result = await this.executeTool({
                role: 'tool_call',
                toolCallId: toolCall.call_id,
                toolName: toolCall.name,
                parameters: toolCall.arguments,
              })
              if (result.skipAnswer) {
                outcome.skipAnswer = true
              }
            }
            break

          default:
            break
        }
      }
      return outcome
    } catch (error) {
      if (produced && !signal.aborted) {
        throw new StepInterruptedError(outcome, error)
      }
      throw error
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
            // Already the JSON the model wrote
            arguments: message.parameters,
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
}

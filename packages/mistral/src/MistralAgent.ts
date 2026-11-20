import { Agent, AgentOptions } from '@micdrop/server'
import { MicdropModel } from '@micdrop/server'
import { Mistral } from '@mistralai/mistralai'
import type {
  ChatCompletionStreamRequest,
  ChatCompletionStreamRequestMessage,
} from '@mistralai/mistralai/models/components'
import { Writable } from 'stream'
import z, { toJSONSchema } from 'zod'
import { textOf } from './deltaText'
import { listMistralModels } from './models'

export interface MistralAgentOptions extends AgentOptions {
  apiKey: string
  model?: string
  // Other parameters of the request. `reasoningEffort` sets how long the
  // model reasons before answering: the lowest level the model accepts brings
  // the first word forward, "none" for Mistral Medium 3.5 and Small 4, "low"
  // for Mistral Large 4.
  settings?: Omit<ChatCompletionStreamRequest, 'messages' | 'model'>
  maxRetry?: number
  retryDelay?: number
  maxSteps?: number
}

// Answers without reasoning, where Mistral Large 4 always reasons first
const DEFAULT_MODEL = 'mistral-medium-latest'
const DEFAULT_MAX_RETRY = 3
const DEFAULT_MAX_STEPS = 5
const DEFAULT_RETRY_DELAY = 500

/** What one request produced */
interface StepOutcome {
  fullAnswer: string
  skipAnswer: boolean
}

/** A request that failed after writing text or running tools */
class StepInterruptedError extends Error {
  constructor(readonly outcome: StepOutcome) {
    super('Answer interrupted')
  }
}

export class MistralAgent extends Agent<MistralAgentOptions> {
  /**
   * Lists the models that can answer a call: chat models that call tools. `reasoning` marks the ones that can reason, slower to answer when they do, each one once with its aliases.
   *
   * The list is fetched once and shared by every call of the process for a
   * day. `refresh` fetches it again.
   */
  static listModels(options: {
    apiKey: string
    refresh?: boolean
  }): Promise<MicdropModel[]> {
    return listMistralModels(
      'agent',
      ({ capabilities }) =>
        capabilities.completion_chat && capabilities.function_calling,
      options
    )
  }

  private mistral: Mistral

  constructor(options: MistralAgentOptions) {
    super(options)
    this.mistral = new Mistral({ apiKey: options.apiKey })
  }

  protected async generateAnswer(stream: Writable, signal: AbortSignal) {
    const maxSteps = this.options.maxSteps || DEFAULT_MAX_STEPS
    const maxRetry = this.options.maxRetry || DEFAULT_MAX_RETRY

    // Each step is one request. A step that only calls tools asks for another
    // one, so the LLM can answer with their results.
    for (let step = 0; step < maxSteps; step++) {
      let outcome: StepOutcome | undefined
      for (let tryCount = 0; !outcome; tryCount++) {
        try {
          outcome = await this.generateStep(stream, signal)
        } catch (error: any) {
          // An aborted request throws too, but that is the cancellation the
          // base asked for, not a failure to report
          if (signal.aborted) return
          if (error instanceof StepInterruptedError) {
            // Text already reached the stream or tools already ran: a retry
            // would say or do it again, so the step keeps what it got
            outcome = error.outcome
            break
          }
          console.error('[MistralAgent] Error:', error)
          if (tryCount >= maxRetry) {
            this.log('Max retries reached, giving up')
            this.emit('Failed')
            return
          }
          await new Promise((resolve) =>
            setTimeout(resolve, this.options.retryDelay || DEFAULT_RETRY_DELAY)
          )
          // Cancelled during the delay: the retry would answer nobody
          if (signal.aborted) return
        }
      }
      if (signal.aborted) return

      if (outcome.fullAnswer) {
        // Add full answer to conversation
        const { message, metadata } = this.extract(outcome.fullAnswer)
        this.addAssistantMessage(message, metadata)
        return
      }
      if (outcome.skipAnswer) {
        // Hack: Mistral needs an assistant message after tool calls
        this.conversation.push({
          role: 'assistant',
          content: ' ',
        })
        return
      }
      // Query again in case of tool call
    }
    console.error('[MistralAgent] Max steps reached')
  }

  /**
   * Runs one request, writing its text to the stream and running its tools.
   *
   * It throws a plain error when the request failed before producing
   * anything, which can then be retried, and a {@link StepInterruptedError}
   * once something was written or done.
   */
  private async generateStep(
    stream: Writable,
    signal: AbortSignal
  ): Promise<StepOutcome> {
    // Hack: Mistral needs a user message if there is only a system message
    if (this.conversation.length === 1) {
      this.conversation.push({
        role: 'user',
        content: '',
      })
    }

    const write = this.answerWriter(stream)
    const outcome: StepOutcome = { fullAnswer: '', skipAnswer: false }
    let produced = false

    try {
      const result = await this.mistral.chat.stream(
        {
          model: this.options.model || DEFAULT_MODEL,
          messages: this.buildMessages(),
          tools: this.buildTools(),
          ...this.options.settings,
        },
        { signal }
      )

      // Handle response events
      for await (const event of result) {
        if (signal.aborted) return outcome
        const delta = event.data.choices[0]?.delta
        const chunk = textOf(delta?.content)
        const toolCalls = delta?.toolCalls

        // Text chunk
        if (chunk !== undefined) {
          if (chunk === '') continue
          this.log(`Answer chunk: "${chunk}"`)
          outcome.fullAnswer += chunk
          produced = true
          write(chunk)
        } else if (toolCalls?.length) {
          for (const toolCall of toolCalls) {
            if (signal.aborted) return outcome
            produced = true
            const result = await this.executeTool({
              role: 'tool_call',
              toolCallId: toolCall.id || '',
              toolName: toolCall.function.name,
              // The SDK hands the arguments over parsed or as JSON
              parameters:
                typeof toolCall.function.arguments === 'string'
                  ? toolCall.function.arguments
                  : JSON.stringify(toolCall.function.arguments),
            })
            if (result.skipAnswer) {
              outcome.skipAnswer = true
            }
          }
        }
      }
    } catch (error) {
      if (!produced || signal.aborted) throw error
      console.error('[MistralAgent] Error after a partial answer:', error)
      throw new StepInterruptedError(outcome)
    }
    return outcome
  }

  private buildMessages(): ChatCompletionStreamRequestMessage[] {
    return this.conversation.map(
      (message): ChatCompletionStreamRequestMessage => {
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
                    // Already the JSON the model wrote
                    arguments: message.parameters,
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
}

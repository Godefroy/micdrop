import { GoogleGenAI } from '@google/genai'
import { Agent, AgentOptions } from '@micdrop/server'
import { PassThrough } from 'stream'
import z, { toJSONSchema } from 'zod'

/**
 * Gemini agent, through the Interactions API
 *
 * @see https://ai.google.dev/gemini-api/docs/text-generation
 *
 * Nothing is stored on Google's side: the whole conversation is sent on every
 * turn, as the other agents do.
 */

export type GeminiAgentOptions = AgentOptions &
  GeminiOptions & {
    model?: string
    // How long the model thinks before answering ("low", "medium", "high").
    // The lower, the sooner the first word.
    thinkingLevel?: string
    // Other generation settings, such as temperature
    settings?: Record<string, unknown>
    retryDelay?: number
    maxRetry?: number
    maxSteps?: number
  }

export type GeminiOptions = { apiKey: string } | { genai: GoogleGenAI }

const DEFAULT_MODEL = 'gemini-3.8-flash'
const DEFAULT_MAX_STEPS = 5
const DEFAULT_MAX_RETRIES = 3
const DEFAULT_RETRY_DELAY = 1000

// Asks for an answer when nothing was said yet, to open the call
const FIRST_MESSAGE_PROMPT = 'The call starts now.'

/** A step of the answer, put together from the events streaming it */
interface StreamedStep {
  type: string
  id?: string
  name?: string
  text: string
  arguments: string
  signature: string
}

export class GeminiAgent extends Agent<GeminiAgentOptions> {
  private genai: GoogleGenAI
  private abortController?: AbortController
  // Gemini asks for the signature of the thought behind a tool call when the
  // call is sent back, and the conversation has no room for it
  private signatures = new Map<string, string>()

  constructor(options: GeminiAgentOptions) {
    super(options)
    this.genai =
      'genai' in options
        ? options.genai
        : new GoogleGenAI({ apiKey: options.apiKey })
  }

  protected async generateAnswer(
    stream: PassThrough,
    stepCount = 0,
    tryCount = 0
  ): Promise<void> {
    if (stepCount >= (this.options.maxSteps || DEFAULT_MAX_STEPS)) {
      console.error('[GeminiAgent] Max steps reached')
      return
    }

    const abortController = new AbortController()
    this.abortController = abortController
    const signal = abortController.signal

    // Prepare extracting
    let extracting = false
    const extractOptions = this.getExtractOptions()

    try {
      // Typed loosely: the conversation is built as plain JSON steps
      const response = (await this.genai.interactions.create(
        {
          model: this.options.model || DEFAULT_MODEL,
          store: false,
          stream: true,
          system_instruction: this.buildSystemInstruction(),
          input: this.buildInput(),
          tools: this.buildTools(),
          ...(this.options.thinkingLevel || this.options.settings
            ? {
                generation_config: {
                  ...this.options.settings,
                  ...(this.options.thinkingLevel
                    ? { thinking_level: this.options.thinkingLevel }
                    : {}),
                },
              }
            : {}),
        } as any,
        { fetchOptions: { signal } }
      )) as unknown as AsyncIterable<any>

      const steps: StreamedStep[] = []
      let answer = ''
      let skipAnswer = false
      let calledTool = false
      // The last thought, whose signature goes with the tool call after it
      let signature = ''

      for await (const event of response) {
        if (abortController !== this.abortController) return

        switch (event.event_type) {
          case 'step.start':
            steps[event.index] = {
              type: event.step.type,
              id: (event.step as any).id,
              name: (event.step as any).name,
              text: '',
              arguments: '',
              signature: '',
            }
            break

          case 'step.delta': {
            const step = steps[event.index]
            if (!step) break
            const delta = event.delta as any

            if (delta.type === 'thought_signature') {
              step.signature += delta.signature ?? ''
            } else if (delta.type === 'arguments_delta') {
              step.arguments += delta.arguments ?? ''
            } else if (delta.type === 'text' && step.type === 'model_output') {
              this.log(`Answer chunk: "${delta.text}"`)
              answer += delta.text

              // Extracting value?
              if (extractOptions) {
                if (extracting) break
                const startTagIndex = delta.text.indexOf(
                  extractOptions.startTag
                )
                if (startTagIndex !== -1) {
                  extracting = true
                  stream.write(delta.text.slice(0, startTagIndex).trimEnd())
                  break
                }
              }
              stream.write(delta.text)
            }
            break
          }

          case 'step.stop': {
            const step = steps[event.index]
            if (step?.type === 'thought') signature = step.signature
            if (step?.type !== 'function_call' || !step.id || !step.name) break

            calledTool = true
            if (signature) this.signatures.set(step.id, signature)
            const result = await this.executeTool({
              role: 'tool_call',
              toolCallId: step.id,
              toolName: step.name,
              parameters: step.arguments || '{}',
            })
            if (result.skipAnswer) skipAnswer = true
            break
          }

          case 'error':
            throw new Error(event.error?.message || 'Generation failed')

          default:
            break
        }
      }

      if (abortController !== this.abortController) return
      this.abortController = undefined

      if (answer) {
        const { message, metadata } = this.extract(answer)
        this.addAssistantMessage(message, metadata)
      }

      // Query again when the model called a tool without answering, so the
      // turn still produces something to say
      if (calledTool && !skipAnswer && !answer) {
        await this.generateAnswer(stream, stepCount + 1)
      }
    } catch (error) {
      if (signal.aborted) return
      console.error('[GeminiAgent] Error answering:', error)

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

  cancel() {
    if (!this.abortController) return
    this.log('Cancel')
    this.abortController.abort()
    this.abortController = undefined
  }

  private buildSystemInstruction(): string {
    return this.conversation
      .flatMap((message) =>
        message.role === 'system' ? [message.content] : []
      )
      .join('\n\n')
  }

  private buildInput(): any[] {
    const input = this.conversation.flatMap((message): any[] => {
      switch (message.role) {
        case 'user':
          return [
            {
              type: 'user_input',
              content: [{ type: 'text', text: message.content }],
            },
          ]
        case 'assistant':
          return [
            {
              type: 'model_output',
              content: [{ type: 'text', text: message.content }],
            },
          ]
        case 'tool_call': {
          const signature = this.signatures.get(message.toolCallId)
          return [
            ...(signature ? [{ type: 'thought', signature }] : []),
            {
              type: 'function_call',
              id: message.toolCallId,
              name: message.toolName,
              arguments: parseArguments(message.parameters),
            },
          ]
        }
        case 'tool_result':
          return [
            {
              type: 'function_result',
              call_id: message.toolCallId,
              name: message.toolName,
              result: [{ type: 'text', text: message.output }],
            },
          ]
        default:
          return []
      }
    })

    // The model needs something to answer to
    if (input.length === 0) {
      input.push({
        type: 'user_input',
        content: [{ type: 'text', text: FIRST_MESSAGE_PROMPT }],
      })
    }
    return input
  }

  private buildTools(): any[] | undefined {
    if (this.tools.length === 0) return undefined
    return this.tools.map((tool) => {
      // The schema keyword is refused, the rest of the JSON schema goes through
      const { $schema, ...parameters } = toJSONSchema(
        tool.inputSchema || z.object()
      ) as Record<string, unknown>
      return {
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters,
      }
    })
  }
}

function parseArguments(parameters: string): unknown {
  try {
    return JSON.parse(parameters)
  } catch {
    return {}
  }
}

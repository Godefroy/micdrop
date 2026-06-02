import { EventEmitter } from 'eventemitter3'
import { PassThrough, Readable, Writable } from 'stream'
import type { z } from 'zod'
import { Logger } from '../Logger'
import {
  MicdropAnswerMetadata,
  MicdropConversation,
  MicdropConversationItem,
  MicdropConversationMessage,
  MicdropConversationToolCall,
  MicdropConversationToolResult,
  MicdropToolCall,
} from '../types'
import {
  AUTO_END_CALL_PROMPT,
  AUTO_END_CALL_TOOL_NAME,
  AUTO_IGNORE_USER_NOISE_PROMPT,
  AUTO_IGNORE_USER_NOISE_TOOL_NAME,
  AUTO_SEMANTIC_TURN_PROMPT,
  AUTO_SEMANTIC_TURN_TOOL_NAME,
  Tool,
} from './tools'

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
  Message: [MicdropConversationItem]
  CancelLastUserMessage: []
  SkipAnswer: []
  EndCall: []
  ToolCall: [MicdropToolCall]
  // Emitted when the agent gives up generating an answer (e.g. after exhausting
  // its retries). Used by FallbackAgent to switch to the next agent.
  Failed: []
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

export abstract class Agent<
  Options extends AgentOptions = AgentOptions,
> extends EventEmitter<AgentEvents> {
  public logger?: Logger
  public conversation: MicdropConversation
  public tools: Tool[]

  protected answerCount = 0
  protected answering = false

  constructor(protected options: Options) {
    super()
    this.conversation = [{ role: 'system', content: options.systemPrompt }]
    this.tools = this.getDefaultTools()
  }

  protected abstract generateAnswer(stream: PassThrough): Promise<void>
  abstract cancel(): void

  answer(): Readable {
    this.log('Start answering')
    const answerCount = ++this.answerCount
    const stream = new PassThrough()
    this.answering = true

    Promise.resolve()
      // Call hook onBeforeAnswer
      .then(() => this.options.onBeforeAnswer?.bind(this)(stream))
      // Generate answer (if not skipped)
      .then((skip) => {
        if (skip) return
        return this.generateAnswer(stream)
      })
      // End stream
      .finally(() => {
        if (stream.writable) {
          stream.end()
        }
        if (answerCount === this.answerCount) {
          this.answering = false
        }
      })

    return stream
  }

  addUserMessage(text: string, metadata?: MicdropAnswerMetadata) {
    this.addMessage('user', text, metadata)
  }

  addAssistantMessage(text: string, metadata?: MicdropAnswerMetadata) {
    this.addMessage('assistant', text, metadata)
  }

  addTool<Schema extends z.ZodObject>(tool: Tool<Schema>) {
    this.tools.push(tool)
  }

  removeTool(name: string) {
    const index = this.tools.findIndex((tool) => tool.name === name)
    if (index !== -1) {
      this.tools.splice(index, 1)
    }
  }

  getTool(name: string): Tool | undefined {
    return this.tools.find((tool) => tool.name === name)
  }

  addMessage(
    role: 'user' | 'assistant' | 'system',
    text: string,
    metadata?: MicdropAnswerMetadata
  ) {
    this.log(`Adding ${role} message to conversation: ${text}`)
    const message: MicdropConversationMessage = {
      role,
      content: text,
      metadata,
    }
    this.conversation.push(message)
    this.emit('Message', message)
  }

  addToolMessage(
    message: MicdropConversationToolCall | MicdropConversationToolResult
  ) {
    this.log('Adding tool message:', message)
    this.conversation.push(message)
    this.emit('Message', message)
  }

  protected endCall() {
    this.log('Ending call')
    this.emit('EndCall')
  }

  protected cancelLastUserMessage() {
    this.log('Cancelling last user message')
    const lastMessageIndex = this.conversation.findLastIndex(
      (message) => message.role === 'user'
    )
    if (lastMessageIndex !== -1) {
      this.conversation.splice(lastMessageIndex, 1)
    }
    this.emit('CancelLastUserMessage')
  }

  protected skipAnswer() {
    this.log('Skipping answer')
    this.emit('SkipAnswer')
  }

  protected getDefaultTools() {
    const tools: Tool[] = []
    if (this.options.autoEndCall) {
      tools.push({
        name: AUTO_END_CALL_TOOL_NAME,
        description:
          typeof this.options.autoEndCall === 'string'
            ? this.options.autoEndCall
            : AUTO_END_CALL_PROMPT,
        execute: (_input, agent) => agent.endCall(),
      })
    }
    if (this.options.autoSemanticTurn) {
      tools.push({
        name: AUTO_SEMANTIC_TURN_TOOL_NAME,
        description:
          typeof this.options.autoSemanticTurn === 'string'
            ? this.options.autoSemanticTurn
            : AUTO_SEMANTIC_TURN_PROMPT,
        skipAnswer: true,
        execute: (_input, agent) => agent.skipAnswer(),
      })
    }
    if (this.options.autoIgnoreUserNoise) {
      tools.push({
        name: AUTO_IGNORE_USER_NOISE_TOOL_NAME,
        description:
          typeof this.options.autoIgnoreUserNoise === 'string'
            ? this.options.autoIgnoreUserNoise
            : AUTO_IGNORE_USER_NOISE_PROMPT,
        skipAnswer: true,
        execute: (_input, agent) => agent.cancelLastUserMessage(),
      })
    }
    return tools
  }

  protected async executeTool(toolCall: MicdropConversationToolCall) {
    try {
      const tool = this.getTool(toolCall.toolName)
      if (!tool) {
        throw new Error(`Tool not found "${toolCall.toolName}"`)
      }

      this.log('Executing tool:', toolCall.toolName, toolCall.parameters)

      // Save tool call in conversation
      this.addToolMessage(toolCall)

      const parameters = JSON.parse(toolCall.parameters)
      const output = tool.execute ? await tool.execute(parameters, this) : {}

      // Save tool result in conversation
      this.addToolMessage({
        role: 'tool_result',
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        output: JSON.stringify(output ?? null),
      })

      // Emit output
      if (tool.emitOutput) {
        this.emit('ToolCall', {
          name: toolCall.toolName,
          parameters,
          output,
        })
      }

      return {
        output,
        skipAnswer: tool.skipAnswer,
      }
    } catch (error: any) {
      console.error('[OpenaiAgent] Error executing tool:', error)
      return {
        output: {
          error: error.message,
        },
      }
    }
  }

  protected getExtractOptions(): ExtractTagOptions | undefined {
    const extract = this.options.extract
    if (!extract) return undefined
    if ('json' in extract && extract.json) {
      return { ...extract, startTag: '{', endTag: '}' }
    }
    if ('startTag' in extract && 'endTag' in extract) {
      return extract
    }
    return undefined
  }

  public extract(message: string) {
    const extractOptions = this.getExtractOptions()
    let metadata: MicdropAnswerMetadata | undefined = undefined

    // Extract value?
    if (extractOptions) {
      const startTagIndex = message.indexOf(extractOptions.startTag)
      if (startTagIndex !== -1) {
        // Find end tag
        let endTagIndex = message.lastIndexOf(extractOptions.endTag)
        if (endTagIndex === -1) endTagIndex = message.length + 1
        else endTagIndex += extractOptions.endTag.length
        const extractedText = message.slice(startTagIndex, endTagIndex).trim()

        // Parse extracted value
        try {
          const extractedValue =
            'json' in extractOptions && extractOptions.json
              ? JSON.parse(extractedText)
              : extractedText

          // Call callback
          if (extractOptions.callback) {
            extractOptions.callback(extractedValue)
          }

          // Save in metadata
          if (extractOptions.saveInMetadata) {
            metadata = { extracted: extractedValue }
          }
        } catch (error) {
          console.error(
            `[OpenaiAgent] Error parsing extracted value (${extractedText}):`,
            error
          )
        }

        // Remove extracted value from message
        message = message.slice(0, startTagIndex).trimEnd()
      }
    }
    return { message, metadata }
  }

  protected log(...message: any[]) {
    this.logger?.log(...message)
  }

  destroy() {
    this.log('Destroyed')
    this.removeAllListeners()
    this.cancel()
  }
}

import { PassThrough } from 'stream'
import { Logger } from '../Logger'
import { MicdropConversationItem, MicdropToolCall } from '../types'
import { Agent } from './Agent'

export interface FallbackAgentOptions {
  factories: Array<() => Agent>
}

export class FallbackAgent extends Agent {
  private agent: Agent | null = null
  private agentIndex = -1 // Start at -1 because we need to increment it before using it

  constructor(private readonly fallbackOptions: FallbackAgentOptions) {
    super({ systemPrompt: '' })
    if (this.fallbackOptions.factories.length === 0) {
      throw new Error('FallbackAgent: No factories provided')
    }
    this.startNextAgent()
  }

  // Delegate extraction to the active agent (extract config lives on children)
  extract(message: string) {
    return this.agent ? this.agent.extract(message) : super.extract(message)
  }

  protected async generateAnswer(stream: PassThrough): Promise<void> {
    // Try each agent once (one full rotation) until one answers successfully.
    // The conversation is shared between agents, so the next agent picks up
    // exactly where the failed one stopped.
    for (
      let attempt = 0;
      attempt < this.fallbackOptions.factories.length;
      attempt++
    ) {
      const agent = this.agent
      if (!agent) return

      let failed = false
      const onFailed = () => {
        failed = true
      }
      agent.once('Failed', onFailed)

      try {
        await this.pipeAnswer(agent, stream)
      } finally {
        agent.off('Failed', onFailed)
      }

      if (!failed) return

      this.log('Agent failed, trying next agent')
      this.startNextAgent()
    }

    // Every agent failed within this rotation: report it so an outer consumer
    // (e.g. a wrapping FallbackAgent) can react.
    this.log('All agents failed')
    this.emit('Failed')
  }

  cancel() {
    this.agent?.cancel()
  }

  destroy() {
    super.destroy()
    this.agent?.destroy()
    this.agent = null
    this.agentIndex = -1
  }

  // Run the child agent and forward its answer chunks to our own stream
  private pipeAnswer(agent: Agent, stream: PassThrough): Promise<void> {
    return new Promise((resolve) => {
      const answerStream = agent.answer()
      answerStream.on('data', (chunk) => {
        if (stream.writable) {
          stream.write(chunk)
        }
      })
      answerStream.on('end', resolve)
      answerStream.on('error', resolve)
    })
  }

  private startNextAgent() {
    this.agentIndex++
    if (this.agentIndex >= this.fallbackOptions.factories.length) {
      this.agentIndex = 0
    }

    const previousAgent = this.agent
    const isFirstAgent = previousAgent === null
    const agent = this.fallbackOptions.factories[this.agentIndex]()
    this.agent = agent

    // Share the conversation and tools between the fallback and the child agent.
    // Both are now portable (tools no longer bind to a specific instance), so a
    // single reference is shared, exactly like the conversation.
    if (isFirstAgent) {
      // Adopt the first agent's conversation and tools (keeps its system prompt)
      this.conversation = agent.conversation
      this.tools = agent.tools
    } else {
      // Keep the accumulated history, but use the new agent's system prompt
      if (agent.conversation[0]?.role === 'system') {
        this.conversation[0] = agent.conversation[0]
      }
      agent.conversation = this.conversation
      agent.tools = this.tools
    }

    // Forward events from the child agent
    agent.on('Message', this.onMessage)
    agent.on('CancelLastUserMessage', this.onCancelLastUserMessage)
    agent.on('SkipAnswer', this.onSkipAnswer)
    agent.on('EndCall', this.onEndCall)
    agent.on('ToolCall', this.onToolCall)

    // Destroy the previous agent (after moving the conversation over)
    previousAgent?.destroy()

    // Set logger after event loop
    setTimeout(() => {
      if (this.agent && this.logger) {
        this.agent.logger = new Logger(this.agent.constructor.name)
      }
    }, 0)
  }

  private onMessage = (message: MicdropConversationItem) => {
    this.emit('Message', message)
  }

  private onCancelLastUserMessage = () => {
    this.emit('CancelLastUserMessage')
  }

  private onSkipAnswer = () => {
    this.emit('SkipAnswer')
  }

  private onEndCall = () => {
    this.emit('EndCall')
  }

  private onToolCall = (toolCall: MicdropToolCall) => {
    this.emit('ToolCall', toolCall)
  }
}

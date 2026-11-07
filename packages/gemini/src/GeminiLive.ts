import {
  MicdropConversationToolCall,
  Pcm16Resampler,
  Realtime,
  RealtimeOptions,
} from '@micdrop/server'
import { toJSONSchema } from 'zod'
import { LiveSocket } from './LiveSocket'

/**
 * Gemini Live API, a model hearing the user and answering with its voice
 *
 * @see https://ai.google.dev/gemini-api/docs/live-api
 *
 * The Micdrop client already tells when the user speaks, so the automatic
 * activity detection of Gemini is off: a turn is framed by activityStart and
 * activityEnd, and the model answers once it ends.
 */

export interface GeminiLiveOptions extends RealtimeOptions {
  apiKey: string
  model?: string
  // Name of a prebuilt voice, such as "Kore" or "Puck"
  voice?: string
  // Required by gemini-3.8-live-extended-thinking ("low", "medium"...),
  // refused by gemini-3.8-live
  thinkingLevel?: string
  connectionTimeout?: number
  retryDelay?: number
  maxRetry?: number
}

const DEFAULT_MODEL = 'gemini-3.8-live'
const SAMPLE_RATE = 16000 // Rate of the Micdrop client, taken as is by Gemini
const GEMINI_OUTPUT_SAMPLE_RATE = 24000
// How long the model gets to speak about the result of a tool
const TOOL_FOLLOW_UP_TIMEOUT = 10000 // ms

/**
 * The tools of the answer being given.
 *
 * Gemini ends its turn when it calls a tool, and speaks again once it has the
 * result. The answer stays open in between, so the client keeps waiting for it
 * rather than listening again. An interruption or a session started over
 * replaces this record, and a tool finishing later sees it is no longer the
 * current one: its result is not sent, so the model never speaks about it.
 */
interface ToolRound {
  // Tools called and not finished yet
  running: number
  // The model has the result of a tool, and gets some time to speak about it
  followUp?: NodeJS.Timeout
  // The model ended its turn while the round was not over, the answer ends
  // with the round
  answerEndDeferred: boolean
}

function newToolRound(): ToolRound {
  return { running: 0, answerEndDeferred: false }
}

// Opens a call when the model speaks first
const FIRST_MESSAGE_PROMPT =
  'The call starts now. Speak first, as your instructions say.'

export class GeminiLive extends Realtime<GeminiLiveOptions> {
  private socket: LiveSocket
  private everConnected = false

  // Resumes the session on a new connection, which Gemini asks for every
  // few minutes
  private resumptionHandle?: string
  private goingAway = false

  private outputResampler = new Pcm16Resampler(
    GEMINI_OUTPUT_SAMPLE_RATE,
    SAMPLE_RATE
  )
  private hasTranscribedTurn = false
  // Transcript of a dropped turn, which the conversation should not show
  private ignoreUserTranscript = false
  // Calls of the session Gemini told not to answer
  private cancelledToolCalls = new Set<string>()
  // Bumped by every session that does not resume the previous one, whose tool
  // calls it cannot answer
  private session = 0
  private toolRound = newToolRound()

  constructor(options: GeminiLiveOptions) {
    super(options)
    this.socket = new LiveSocket(
      options,
      () => this.buildSetup(),
      (...message) => this.log(...message)
    )
    this.socket.on('Ready', this.onReady)
    this.socket.on('Message', this.onMessage)
    this.socket.on('Reconnecting', this.onReconnecting)
    this.socket.on('Failed', () => this.emit('Failed'))
    this.socket.connect()
  }

  /**
   * Stops the answer. The tools it is waiting for still send their results,
   * silently, since a blocking call left unanswered would stall the model.
   */
  cancel() {
    super.cancel()
    this.resetToolRound()
  }

  destroy() {
    // Cancels the answer too, which resets the tool round
    super.destroy()
    this.socket.destroy()
  }

  protected openTurn() {
    this.ignoreUserTranscript = false
    this.send({ realtimeInput: { activityStart: {} } })
  }

  protected appendAudio(chunk: Buffer) {
    this.send({
      realtimeInput: {
        audio: {
          mimeType: `audio/pcm;rate=${SAMPLE_RATE}`,
          data: chunk.toString('base64'),
        },
      },
    })
  }

  protected closeTurn() {
    this.hasTranscribedTurn = false
    this.send({ realtimeInput: { activityEnd: {} } })
  }

  protected clearTurn() {
    // Gemini has no way to drop the audio of a turn: it ends, and its answer
    // is discarded
    this.ignoreUserTranscript = true
    this.send({ realtimeInput: { activityEnd: {} } })
  }

  protected generate() {
    this.sendUserText(FIRST_MESSAGE_PROMPT)
  }

  protected speakText(text: string) {
    this.sendUserText(
      `Say exactly the following text, word for word, and nothing else: ${text}`
    )
  }

  protected cancelAnswer() {
    // The activityStart of the next turn is what stops Gemini, and the output
    // still on its way is dropped until the model acknowledges it
    this.outputResampler.reset()
  }

  protected get isIdle() {
    return super.isIdle && this.toolRound.running === 0
  }

  protected updateTools() {
    if (this.everConnected) {
      this.log('Tools changed after the session started, Gemini keeps the old')
    }
  }

  protected injectMessage(role: 'user' | 'assistant' | 'system', text: string) {
    // The whole conversation is sent again when a session cannot be resumed
    if (
      !this.socket.isConnected &&
      this.everConnected &&
      !this.resumptionHandle
    )
      return
    this.send(this.contentMessage(role, text, false))
  }

  private sendUserText(text: string) {
    this.send(this.contentMessage('user', text, true))
  }

  private contentMessage(
    role: 'user' | 'assistant' | 'system',
    text: string,
    turnComplete: boolean
  ) {
    return {
      clientContent: {
        turns: [
          {
            role: role === 'assistant' ? 'model' : 'user',
            parts: [{ text }],
          },
        ],
        turnComplete,
      },
    }
  }

  private send(message: any) {
    this.socket.send(message)
  }

  private buildSetup() {
    const functionDeclarations = this.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      ...(tool.inputSchema
        ? { parametersJsonSchema: toJSONSchema(tool.inputSchema) }
        : {}),
    }))

    return {
      setup: {
        model: `models/${this.options.model || DEFAULT_MODEL}`,
        generationConfig: {
          responseModalities: ['AUDIO'],
          ...(this.options.thinkingLevel
            ? { thinkingConfig: { thinkingLevel: this.options.thinkingLevel } }
            : {}),
          ...(this.options.voice
            ? {
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: this.options.voice },
                  },
                },
              }
            : {}),
        },
        systemInstruction: { parts: [{ text: this.options.systemPrompt }] },
        ...(functionDeclarations.length > 0
          ? { tools: [{ functionDeclarations }] }
          : {}),
        // The Micdrop client detects when the user speaks
        realtimeInputConfig: {
          automaticActivityDetection: { disabled: true },
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        sessionResumption: this.resumptionHandle
          ? { handle: this.resumptionHandle }
          : {},
        // Lifts the length limit of a session
        contextWindowCompression: { slidingWindow: {} },
      },
    }
  }

  private onReady = (setup: any) => {
    const resumed = !!setup?.setup?.sessionResumption?.handle
    // A session started over has lost the conversation, and knows nothing of
    // the tools the previous one called
    if (this.everConnected && !resumed) {
      this.startFreshSession()
      const turns = this.conversation.flatMap((message) =>
        message.role === 'user' || message.role === 'assistant'
          ? [
              {
                role: message.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: message.content }],
              },
            ]
          : []
      )
      if (turns.length > 0) {
        this.socket.sendFirst({ clientContent: { turns, turnComplete: false } })
      }
    }
    this.everConnected = true
    this.goingAway = false
  }

  private onReconnecting = (attempt: number) => {
    // A handle that failed once may have expired, start a new session
    if (attempt > 1) this.resumptionHandle = undefined
    // What waits for a resumed session is still valid, a new session gets the
    // conversation instead
    if (!this.resumptionHandle) {
      this.socket.clearPending()
      this.startFreshSession()
    }
    // The answer in progress is lost with the connection, after what was
    // heard of the turn it answered
    this.toolRound.answerEndDeferred = false
    this.commitTurnTranscript()
    this.endAnswer()
  }

  /** Forgets what belonged to the previous session */
  private startFreshSession() {
    this.session++
    this.resetToolRound()
    this.cancelledToolCalls.clear()
    this.ignoreUserTranscript = false
  }

  /**
   * Starts a new round of tools. The tools still running belong to the old
   * one: their results go out silently, and nothing waits for the model to
   * talk about them.
   */
  private resetToolRound() {
    if (this.toolRound.followUp) clearTimeout(this.toolRound.followUp)
    this.toolRound = newToolRound()
  }

  /** Moves to a new connection before Gemini closes this one */
  private renewIfGoingAway() {
    if (!this.goingAway || !this.isIdle || !this.resumptionHandle) return
    this.goingAway = false
    this.socket.renew()
  }

  private onMessage = (message: any) => {
    if (message.serverContent) {
      this.onServerContent(message.serverContent)
    }

    if (message.toolCall) {
      for (const call of message.toolCall.functionCalls ?? []) {
        this.onToolCall(call)
      }
    }

    if (message.toolCallCancellation) {
      for (const id of message.toolCallCancellation.ids ?? []) {
        this.cancelledToolCalls.add(id)
      }
    }

    if (message.sessionResumptionUpdate) {
      const { newHandle, resumable } = message.sessionResumptionUpdate
      if (resumable && newHandle) this.resumptionHandle = newHandle
    }

    if (message.goAway) {
      this.log('Connection ending in', message.goAway.timeLeft)
      this.goingAway = true
      this.renewIfGoingAway()
    }
  }

  private onServerContent(content: any) {
    if (content.inputTranscription?.text && !this.ignoreUserTranscript) {
      this.addUserTranscript(content.inputTranscription.text)
    }

    for (const part of content.modelTurn?.parts ?? []) {
      const data = part.inlineData?.data
      if (!data) continue
      this.onModelOutput()
      const output = this.outputResampler.process(Buffer.from(data, 'base64'))
      if (output.length > 0) this.emitAudio(output)
    }

    if (content.outputTranscription?.text) {
      this.onModelOutput()
      this.addAnswerTranscript(content.outputTranscription.text)
    }

    if (content.interrupted) {
      this.log('Interrupted')
      this.outputResampler.reset()
    }

    if (content.generationComplete) {
      this.commitTurnTranscript()
    }

    if (content.turnComplete) {
      this.commitTurnTranscript()
      this.outputResampler.reset()
      if (this.toolRound.running > 0 || this.toolRound.followUp) {
        this.toolRound.answerEndDeferred = true
      } else {
        this.endAnswer()
        this.renewIfGoingAway()
      }
    }
  }

  private onModelOutput() {
    this.commitTurnTranscript()
    // The model speaks about the result, its next turn ends the answer
    const round = this.toolRound
    if (round.followUp) {
      clearTimeout(round.followUp)
      round.followUp = undefined
      round.answerEndDeferred = false
    }
  }

  /** Ends the answer the model stopped giving to wait for a tool */
  private endDeferredAnswer() {
    const round = this.toolRound
    if (!round.answerEndDeferred) return
    if (round.running > 0 || round.followUp) return
    round.answerEndDeferred = false
    this.endAnswer()
    this.renewIfGoingAway()
  }

  /**
   * The transcript of the turn comes before the answer, so the first piece of
   * the answer closes it.
   */
  private commitTurnTranscript() {
    if (this.hasTranscribedTurn) return
    this.hasTranscribedTurn = true
    this.commitUserTranscript()
  }

  private async onToolCall(call: { id: string; name: string; args?: any }) {
    // The question comes before the tool it asks for
    this.commitTurnTranscript()
    const toolCall: MicdropConversationToolCall = {
      role: 'tool_call',
      toolCallId: call.id,
      toolName: call.name,
      parameters: JSON.stringify(call.args ?? {}),
    }
    const round = this.toolRound
    const session = this.session
    round.running++
    let result: Awaited<ReturnType<GeminiLive['runTool']>>
    try {
      result = await this.runTool(toolCall)
    } finally {
      round.running--
    }
    // Called by a session that is gone, which knows nothing of this call: the
    // result stays in the conversation only
    if (session !== this.session) return
    if (this.cancelledToolCalls.delete(call.id)) {
      this.endDeferredAnswer()
      return
    }
    // Interrupted while it ran: the model hears the result without speaking
    // about it, over the user who has moved on
    const interrupted = round !== this.toolRound
    const silent = result.skipAnswer || interrupted
    this.send({
      toolResponse: {
        functionResponses: [
          {
            id: call.id,
            name: call.name,
            response: {
              output: result.output ?? null,
              // A tool without an answer lets the model know silently
              scheduling: silent ? 'SILENT' : 'WHEN_IDLE',
            },
          },
        ],
      },
    })

    if (interrupted) return
    if (!result.skipAnswer) {
      if (round.followUp) clearTimeout(round.followUp)
      round.followUp = setTimeout(() => {
        round.followUp = undefined
        this.log('Nothing said about the tool result')
        this.endDeferredAnswer()
      }, TOOL_FOLLOW_UP_TIMEOUT)
    } else {
      this.endDeferredAnswer()
    }
  }
}

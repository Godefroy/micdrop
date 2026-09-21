import { EventEmitter } from 'eventemitter3'
import { Duplex, PassThrough, Readable, Transform } from 'stream'
import { WebSocket } from 'ws'
import type { Agent } from './agent'
import { type Classifier, turnInput } from './classifier'
import { pcm16ToFloat32 } from './audio'
import { Logger } from './Logger'
import type { Realtime } from './realtime'
import type { STT } from './stt'
import type { TTS } from './tts'
import {
  MicdropAnswerMetadata,
  MicdropCallSummary,
  MicdropClientCommands,
  MicdropConversation,
  MicdropConversationItem,
  MicdropConversationMessage,
  MicdropServerCommands,
  TurnDetector,
} from './types'

/** Rate the client records at, and sends its chunks in */
const USER_SAMPLE_RATE = 16000

/**
 * How long an answer waits once the detector asked for the rest of a sentence.
 *
 * The way out of a wrong verdict: a speaker who never comes back still gets an
 * answer instead of a call that goes quiet.
 */
const DEFAULT_TURN_MAX_WAIT = 4000 // ms

/** How long an answer waits for the classification of its turn, by default */
const DEFAULT_CLASSIFICATION_MAX_WAIT = 1000 // ms

export interface MicdropServerEvents {
  End: [MicdropCallSummary]
  /** A message was added to the conversation, by the agent or by the server */
  Message: [MicdropConversationItem]
  UserAudio: [Buffer]
  AssistantAudio: [Buffer]
}

export interface MicdropConfig {
  /**
   * Opening line, spoken before the user has said anything.
   *
   * It goes into the conversation like any other assistant message. Leaving it
   * out, along with `generateFirstMessage`, hands the first turn to the user.
   */
  firstMessage?: string

  /**
   * Asks the agent for its opening line instead of fixing one, so the greeting
   * can lean on the system prompt and on whatever the call was given.
   *
   * Ignored when `firstMessage` is set, and out of reach without an agent.
   */
  generateFirstMessage?: boolean

  /**
   * Generates the answers.
   *
   * Leaving it out turns the call into a one-way one: what the user says is
   * transcribed and sent to the client, and the assistant stays quiet unless
   * the application calls `speak()` itself.
   */
  agent?: Agent

  /**
   * Turns what the user says into text, the one component a call cannot do
   * without, unless a realtime model hears the user itself.
   *
   * It is fed the audio of each turn as it arrives, and the transcripts it
   * returns drive everything that follows.
   */
  stt?: STT

  /**
   * Gives the answers a voice.
   *
   * Leaving it out keeps the call textual: the answer reaches the client as a
   * message and nothing is synthesized.
   */
  tts?: TTS

  /**
   * Sends the answer to the client while it is still being written, on top of
   * the complete message that follows.
   *
   * Works with any agent, since the text is read from the stream it writes to.
   * Off by default, since a client that only displays finished messages has
   * nothing to do with it.
   */
  partialMessages?: boolean

  /**
   * Waits for the rest of the sentence when the speaker paused in the middle
   * of one, instead of answering an unfinished question.
   *
   * Prefer running the detector in the client, which reaches the same decision
   * without the round trip and can then close its turns sooner. This is the
   * option for the browsers where the model has nowhere to run.
   */
  turnDetector?: TurnDetector

  /** How long to wait for the rest of a sentence, 4000 ms by default */
  turnMaxWait?: number

  /**
   * Hears the user and answers with its own voice, in place of `stt`, `agent`
   * and `tts`, which are then ignored.
   *
   * The client does not change: it still detects when the user speaks, and the
   * turn it sends goes to the model as audio.
   */
  realtime?: Realtime

  /**
   * Classifies each turn of the user when it ends, with a `MicdropTurnInput`:
   * the turn, and the turn before with its answer.
   *
   * It works next to the agent and leaves the answer to it. A classification
   * of the turn goes in the metadata of its last user message, under
   * `classification`, where `getTurnClassification()` reads it.
   */
  classifier?: Classifier<any, any>

  /** How the server uses the classifier */
  classifierOptions?: MicdropClassifierOptions
}

export interface MicdropClassifierOptions {
  /**
   * Sends every classification to the client, which emits it as
   * `Classification`.
   *
   * Off by default, since a result can hold what the user should not see, a
   * manipulation score for instance.
   */
  sendToClient?: boolean

  /**
   * Holds each answer until the classification of its turn is done, so the
   * agent can read it in `onBeforeAnswer`. Off by default: the answer starts
   * right away and the classification runs next to it.
   */
  waitBeforeAnswer?: boolean

  /**
   * How long `waitBeforeAnswer` holds an answer, 1000 ms by default. A
   * classification that takes longer lets the answer go without it.
   */
  maxWait?: number

  /**
   * How many turns of the user before this one the input holds, with the
   * answers that followed them. 1 by default: the turn before, its answer,
   * and this turn.
   */
  history?: number
}

export class MicdropServer extends EventEmitter<MicdropServerEvents> {
  public socket: WebSocket | null = null
  public config: MicdropConfig | null = null
  public logger?: Logger

  private startTime = Date.now()
  private lastMessageSpeeched?: MicdropConversationItem

  // Holds the conversation when no agent does, and keeps it readable once the
  // call is over and the config is gone
  private ownConversation: MicdropConversation = []

  // Queue system for operations
  private operationQueue: Array<() => Promise<void>> = []
  private isProcessingQueue = false

  // When user is speaking, we're streaming chunks for STT
  private currentUserStream?: Duplex
  private userSpeechChunks = 0
  // Asked as soon as the speaker pauses, so it weighs that stretch of audio
  // and not the next one
  private turnComplete?: Promise<boolean>
  private heldTurnTimer?: ReturnType<typeof setTimeout>

  constructor(socket: WebSocket, config: MicdropConfig) {
    super()
    this.socket = socket
    this.config = config
    this.log(`Call started`)

    const { realtime } = config
    if (realtime) {
      // Setup realtime model
      realtime.on('Audio', this.onAssistantAudio)
      if (config.partialMessages) {
        realtime.on('PartialMessage', (content) =>
          this.sendPartialAnswer(content)
        )
      }
    } else {
      if (!config.stt) {
        throw new Error('MicdropServer needs an stt, or a realtime model')
      }

      // Setup STT
      config.stt.on('Transcript', this.onTranscriptSTT)

      // Setup TTS
      config.tts?.on('Audio', this.onAssistantAudio)
    }

    // Setup agent, which a realtime model is too
    const agent = this.agent
    if (agent) {
      agent.on('Message', this.onMessageAgent)
      agent.on('CancelLastUserMessage', () =>
        this.socket?.send(MicdropServerCommands.CancelLastUserMessage)
      )
      agent.on('SkipAnswer', () =>
        this.socket?.send(MicdropServerCommands.SkipAnswer)
      )
      agent.on('EndCall', () =>
        this.socket?.send(MicdropServerCommands.EndCall)
      )
      agent.on('ToolCall', (toolCall) =>
        this.socket?.send(
          `${MicdropServerCommands.ToolCall} ${JSON.stringify(toolCall)}`
        )
      )
    }

    // Setup classifier
    if (config.classifierOptions?.sendToClient) {
      config.classifier?.on('Classification', (classification) =>
        this.socket?.send(
          `${MicdropServerCommands.Classification} ${JSON.stringify(classification)}`
        )
      )
    }

    // Assistant speaks first
    // Deferred so consumers (e.g. MicdropRecorder) can subscribe to the server
    // events before the first message is added to the conversation.
    queueMicrotask(() => this.sendFirstMessage())

    // Listen to events
    socket.on('close', this.onClose)
    socket.on('message', this.onMessage)
  }

  /** Everything said so far, whether an agent or the server keeps it */
  get conversation(): MicdropConversation {
    return this.agent?.conversation ?? this.ownConversation
  }

  /** What holds the conversation and answers, a realtime model included */
  private get agent(): Agent | undefined {
    if (!this.config) return undefined
    return this.config.realtime ?? this.config.agent
  }

  private log(...message: any[]) {
    this.logger?.log(...message)
  }

  private async processQueue() {
    if (this.isProcessingQueue || this.operationQueue.length === 0) return

    this.isProcessingQueue = true

    while (this.operationQueue.length > 0) {
      const operation = this.operationQueue.shift()
      if (operation) {
        try {
          await operation()
        } catch (error) {
          this.log('Error processing queued operation:', error)
        }
      }
    }

    this.isProcessingQueue = false
  }

  private queueOperation(operation: () => Promise<void>) {
    this.operationQueue.push(operation)
    this.processQueue()
  }

  public cancel() {
    // The user speaks again: the turn goes on, and is classified again whole
    this.config?.classifier?.cancel()
    this.config?.tts?.cancel()
    this.agent?.cancel()
    // Clear the queue
    this.operationQueue = []
  }

  private onClose = () => {
    this.releaseHeldTurn()
    if (!this.config) return
    this.log('Connection closed')
    const duration = Math.round((Date.now() - this.startTime) / 1000)
    const conversation = this.conversation

    // Destroy instances
    this.agent?.destroy()
    this.config.stt?.destroy()
    this.config.tts?.destroy()
    this.config.classifier?.destroy()

    // Emit End event
    this.emit('End', {
      conversation,
      duration,
    })

    // Unset params, keeping the conversation readable
    this.ownConversation = conversation
    this.socket = null
    this.config = null
  }

  private onMessage = async (message: Buffer) => {
    if (message.byteLength === 0) return
    if (!Buffer.isBuffer(message)) {
      this.log('Message is not a buffer')
      return
    }

    // Commands
    if (message.byteLength < 15) {
      const cmd = message.toString()
      this.log(`Command: ${cmd}`)

      if (cmd === MicdropClientCommands.StartSpeaking) {
        // User started speaking
        this.onStartSpeaking()
      } else if (cmd === MicdropClientCommands.Mute) {
        // User muted the call
        this.onMute()
      } else if (cmd === MicdropClientCommands.StopSpeaking) {
        // User stopped speaking
        this.onStopSpeaking()
      }
    }

    // Audio chunk
    else if (this.currentUserStream) {
      this.onUserAudio(message)
    }
  }

  private onUserAudio(chunk: Buffer) {
    this.log(`Received chunk (${chunk.byteLength} bytes)`)
    this.currentUserStream?.write(chunk)
    this.userSpeechChunks++
    this.config?.turnDetector?.push(pcm16ToFloat32(chunk), USER_SAMPLE_RATE)
    this.emit('UserAudio', chunk)
  }

  private onMute() {
    this.userSpeechChunks = 0
    this.currentUserStream?.end()
    this.currentUserStream = undefined
    this.cancel()
    this.config?.realtime?.discardTurn()
  }

  private onStartSpeaking() {
    if (!this.config) return
    this.userSpeechChunks = 0
    this.currentUserStream?.end()
    this.currentUserStream = new PassThrough()
    this.config.turnDetector?.reset()
    this.turnComplete = undefined
    // The rest of the sentence is arriving, so the deadline can go
    this.releaseHeldTurn()
    if (this.config.realtime) {
      this.cancel()
      this.config.realtime.startTurn(this.currentUserStream)
    } else {
      this.config.stt?.transcribe(this.currentUserStream)
      this.cancel()
    }
  }

  private onStopSpeaking() {
    const hasNoUserSpeech =
      !this.currentUserStream || this.userSpeechChunks === 0
    this.currentUserStream?.end()
    this.currentUserStream = undefined
    this.userSpeechChunks = 0

    // If user is not speaking or no chunks were received, skip
    if (hasNoUserSpeech) {
      this.socket?.send(MicdropServerCommands.SkipAnswer)
      return
    }

    // Weigh the stretch of audio that just ended, before the next one starts
    this.turnComplete = this.predictTurnComplete()

    // A realtime model answers the audio, with no transcript to wait for
    if (this.config?.realtime) {
      this.answerUserTurn()
      return
    }

    const conversation = this.conversation
    const lastMessage = conversation[conversation.length - 1]
    if (
      lastMessage?.role === 'user' &&
      this.lastMessageSpeeched !== lastMessage
    ) {
      this.log(
        'User stopped speaking and a transcript already exists, answering'
      )
      this.answerUserTurn()
    }
  }

  private async predictTurnComplete(): Promise<boolean> {
    const detector = this.config?.turnDetector
    if (!detector) return true
    try {
      const { complete } = await detector.predict()
      this.log(`Turn sounds ${complete ? 'finished' : 'unfinished'}`)
      return complete
    } catch (error) {
      this.log(`Turn detection failed: ${error}`)
      return true
    }
  }

  /** Answers, unless the sentence sounds like it has more coming */
  private async answerUserTurn() {
    const complete = await (this.turnComplete ?? Promise.resolve(true))
    if (!complete) {
      this.log('Waiting for the rest of the sentence')
      this.socket?.send(MicdropServerCommands.SkipAnswer)
      this.holdTurn()
      return
    }
    this.releaseHeldTurn()
    this.cancel()
    this.answerTurn()
  }

  /**
   * Answers anyway if the rest of the sentence never comes.
   *
   * Without it, a detector that hears an unfinished sentence where there is
   * none leaves the call silent for good.
   */
  private holdTurn() {
    this.releaseHeldTurn()
    this.heldTurnTimer = setTimeout(() => {
      this.heldTurnTimer = undefined
      this.log('Nothing more came, answering')
      this.cancel()
      this.answerTurn()
    }, this.config?.turnMaxWait ?? DEFAULT_TURN_MAX_WAIT)
  }

  /** Answers what the user just said */
  private answerTurn() {
    const realtime = this.config?.realtime
    if (realtime) {
      realtime.endTurn()
    } else {
      // The turn is over, with or without an agent to answer it
      this.classifyTurn()
      this.answer()
    }
  }

  private releaseHeldTurn() {
    if (!this.heldTurnTimer) return
    clearTimeout(this.heldTurnTimer)
    this.heldTurnTimer = undefined
  }

  private onTranscriptSTT = async (transcript: string) => {
    if (!this.config) return

    // Skip answer if transcript is empty
    if (transcript === '') {
      this.socket?.send(MicdropServerCommands.SkipAnswer)
      return
    }

    this.log(`User transcript: "${transcript}"`)
    this.addUserMessage(transcript)

    // Answer if user stopped speaking
    if (!this.currentUserStream) {
      this.log('User stopped speaking, answering')
      this.answerUserTurn()
    }
  }

  private onAssistantAudio = (audio: Buffer) => {
    if (!this.socket) return
    this.log(`Send audio chunk (${audio.byteLength} bytes)`)
    this.socket.send(audio)
    this.emit('AssistantAudio', audio)
  }

  private onMessageAgent = (message: MicdropConversationItem) => {
    this.sendMessage(message)
  }

  /** Adds a message to the conversation and sends it to the client */
  public addUserMessage(text: string, metadata?: MicdropAnswerMetadata) {
    if (this.agent) {
      this.agent.addUserMessage(text, metadata)
    } else {
      this.addOwnMessage('user', text, metadata)
    }
  }

  /** Adds a message to the conversation and sends it to the client */
  public addAssistantMessage(text: string, metadata?: MicdropAnswerMetadata) {
    if (this.agent) {
      this.agent.addAssistantMessage(text, metadata)
    } else {
      this.addOwnMessage('assistant', text, metadata)
    }
  }

  private addOwnMessage(
    role: 'user' | 'assistant',
    text: string,
    metadata?: MicdropAnswerMetadata
  ) {
    if (text.trim() === '') {
      this.log(`Skipping empty ${role} message`)
      return
    }
    this.log(`Adding ${role} message to conversation: ${text}`)
    const message: MicdropConversationMessage = {
      role,
      content: text,
      metadata,
    }
    this.ownConversation.push(message)
    this.sendMessage(message)
  }

  private sendMessage(message: MicdropConversationItem) {
    this.socket?.send(
      `${MicdropServerCommands.Message} ${JSON.stringify(message)}`
    )
    this.emit('Message', message)

    // A transcript landed, or the application added a user message
    // A realtime model answers on its own, so its turn ends with its
    // transcript, which comes in one piece
    if (message.role === 'user' && this.config?.realtime) this.classifyTurn()
  }

  private sendPartialAnswer(content: string) {
    if (!this.socket || content === '') return
    this.log(`Send partial answer: "${content}"`)
    this.socket.send(
      `${MicdropServerCommands.PartialAssistantMessage} ${JSON.stringify(content)}`
    )
  }

  private sendFirstMessage() {
    if (!this.config) return
    if (this.config.firstMessage) {
      // Send first message
      // Without an agent, speak() is the one adding it to the conversation
      this.agent?.addAssistantMessage(this.config.firstMessage)
      this.speak(this.config.firstMessage)
    } else if (this.config.generateFirstMessage && this.agent) {
      // Generate first message
      this.answer()
    } else {
      // Skip answer if no first message is provided
      // to avoid keeping the client in a processing state
      this.socket?.send(MicdropServerCommands.SkipAnswer)
    }
  }

  public answer() {
    // The answer waits in the queue behind the classification of its turn, so
    // a cancel meanwhile, which empties the queue, drops it
    if (this.config?.classifierOptions?.waitBeforeAnswer) {
      this.queueOperation(() => this.waitForClassification())
    }
    this.queueOperation(async () => {
      await this._answer()
    })
  }

  private async _answer() {
    if (!this.config) return

    // A realtime model speaks its answer itself
    if (this.config.realtime) {
      this.config.realtime.respond()
      return
    }

    // Nothing generates an answer, hand the turn back to the user
    if (!this.config.agent) {
      this.log('No agent, skipping answer')
      this.socket?.send(MicdropServerCommands.SkipAnswer)
      return
    }

    // Prevent answering twice
    const conversation = this.config.agent.conversation
    const lastMessage = conversation[conversation.length - 1]
    if (this.lastMessageSpeeched === lastMessage) {
      this.log('Already answered, skipping')
      return
    }
    this.lastMessageSpeeched = lastMessage

    try {
      // LLM: Generate answer
      const stream = this.config.agent.answer()

      // TTS: Generate answer audio, unless there is nothing to say.
      //
      // An answer can be skipped after the fact: a tool with skipAnswer, or an
      // onBeforeAnswer hook returning true, ends the stream without a word in
      // it. Handing that empty stream to the TTS opens a synthesis request for
      // nothing, and a provider that stamps each request (Gradium multiplexes
      // this way) then drops the audio of the sentence still playing, so a
      // skipped answer cuts the assistant off mid-word.
      if (await hasContent(stream)) {
        await this._speak(
          this.config.partialMessages
            ? this.forwardPartialAnswer(stream)
            : stream
        )
      } else {
        this.socket?.send(MicdropServerCommands.SkipAnswer)
      }
    } catch (error) {
      this.socket?.send(MicdropServerCommands.SkipAnswer)
      throw error
    }
  }

  /** Sends the answer to the client as it is written, ahead of the voice */
  private forwardPartialAnswer(stream: Readable): Readable {
    let content = ''
    const send = (text: string) => this.sendPartialAnswer(text)
    const forward = new Transform({
      transform(chunk, _encoding, callback) {
        content += chunk.toString()
        send(content)
        callback(null, chunk)
      },
    })
    return stream.pipe(forward)
  }

  /**
   * Classifies the turn that just ended, with the one before, and keeps the
   * result in the metadata of its last message
   */
  private classifyTurn() {
    const classifier = this.config?.classifier
    if (!classifier) return
    const { input, message } = turnInput(
      this.conversation,
      this.config?.classifierOptions?.history
    )
    if (!message || input.turn.trim() === '') return
    classifier.classify(input).then((classification) => {
      if (!classification) return
      message.metadata = { ...message.metadata, classification }
    })
  }

  /** Waits for the classification in progress, never longer than its limit */
  private async waitForClassification() {
    const pending = this.config?.classifier?.pending
    if (!pending) return
    const limit =
      this.config?.classifierOptions?.maxWait ?? DEFAULT_CLASSIFICATION_MAX_WAIT
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        this.log(`Classification took over ${limit} ms, answering without it`)
        resolve()
      }, limit)
    })
    await Promise.race([pending, timeout])
    clearTimeout(timer)
  }

  // Run text-to-speech and send to client
  public speak(message: string | Readable) {
    this.queueOperation(async () => {
      await this._speak(message)
    })
  }

  private async _speak(message: string | Readable) {
    if (!this.socket || !this.config) return

    // A realtime model reads the text in its own voice
    if (this.config.realtime) {
      const text =
        typeof message === 'string' ? message : await readText(message)
      if (text.trim() !== '') this.config.realtime.say(text)
      return
    }

    // Convert message to stream if needed
    let textStream: Readable
    if (typeof message === 'string') {
      // Without an agent, nothing else records what the assistant says
      if (!this.config.agent) {
        this.addOwnMessage('assistant', message)
      }
      const stream = new PassThrough()
      stream.write(message)
      stream.end()
      textStream = stream
    } else {
      textStream = message
    }

    // Run TTS
    if (this.config.tts) {
      this.config.tts.speak(textStream)
      return
    }

    // No voice to synthesize: read the answer to the end, then hand the turn
    // back, since it is the first audio chunk that normally tells the client
    // it can stop waiting.
    await drain(textStream)
    this.socket?.send(MicdropServerCommands.SkipAnswer)
  }
}

/**
 * Resolves true as soon as the stream holds something to read, false if it ends
 * without ever carrying anything.
 *
 * The chunk read to find out is put back, so the consumer that follows sees the
 * whole stream from its first byte.
 */
function hasContent(stream: Readable): Promise<boolean> {
  return new Promise((resolve) => {
    const onReadable = () => {
      const chunk = stream.read()
      if (chunk === null) return
      stream.unshift(chunk)
      done(true)
    }
    const onEnd = () => done(false)
    const done = (result: boolean) => {
      stream.off('readable', onReadable)
      stream.off('end', onEnd)
      resolve(result)
    }
    stream.on('readable', onReadable)
    stream.on('end', onEnd)
  })
}

/** Reads a text stream to its end */
function readText(stream: Readable): Promise<string> {
  return new Promise((resolve) => {
    let text = ''
    stream.on('data', (chunk) => (text += chunk.toString()))
    stream.once('end', () => resolve(text))
    stream.once('error', () => resolve(text))
  })
}

/** Reads a stream to its end, for when nothing else consumes it */
function drain(stream: Readable): Promise<void> {
  return new Promise((resolve) => {
    stream.on('data', () => {})
    stream.once('end', () => resolve())
    stream.once('error', () => resolve())
    stream.once('close', () => resolve())
  })
}

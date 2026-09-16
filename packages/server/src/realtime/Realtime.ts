import { PassThrough, Readable } from 'stream'
import type { z } from 'zod'
import { Agent, AgentEvents, AgentOptions, Tool } from '../agent'
import { MicdropAnswerMetadata, MicdropConversationToolCall } from '../types'

export type RealtimeOptions = Pick<
  AgentOptions,
  'systemPrompt' | 'autoEndCall' | 'autoSemanticTurn' | 'autoIgnoreUserNoise'
>

export interface RealtimeEvents extends AgentEvents {
  /** Voice of the assistant, in PCM16 at 16 kHz */
  Audio: [Buffer]
  /** What the assistant has said so far in the answer it is giving */
  PartialMessage: [string]
}

/**
 * How long the answer waits for the transcript of the turn it answers.
 *
 * Transcription runs apart from the answer and can land after it, while the
 * conversation has to read the question before the answer. Past this delay the
 * answer is recorded anyway, and a transcript arriving later follows it.
 */
const USER_TRANSCRIPT_TIMEOUT = 3000 // ms

interface RealtimeAnswer {
  transcript: string
  hasAudio: boolean
  /** Off for text the application records itself, see `say()` */
  record: boolean
  /** The model spoke before a tool call, and its next words start anew */
  resumed: boolean
}

function newAnswer(record: boolean): RealtimeAnswer {
  return { transcript: '', hasAudio: false, record, resumed: false }
}

/**
 * A model that hears the user and answers with its own voice, standing in for
 * the speech to text, the agent and the text to speech of a call.
 *
 * It is an agent: it holds the conversation and the tools, and emits the same
 * events. What differs is what goes in and out, audio in turns rather than
 * transcripts, and audio rather than text.
 *
 * This class keeps what every provider shares: when a turn opens, which
 * answer the output belongs to, dropping what arrives after an interruption,
 * and writing the conversation in the order it was spoken. A provider
 * implements the protected methods that talk to its API.
 */
export abstract class Realtime<
  Options extends RealtimeOptions = RealtimeOptions,
> extends Agent<Options, RealtimeEvents> {
  // A turn opens with its first audio, so a blip without any sends nothing
  private turn: 'none' | 'pending' | 'open' = 'none'
  private currentAnswer?: RealtimeAnswer
  // Output of an interrupted answer can still be on its way
  private discarding = false
  // Answers asked for while another one was being given
  private queue: Array<() => void> = []
  private answerWaiters: Array<() => void> = []

  private userTranscript = ''
  private awaitingUserTranscript = false
  private userTranscriptTimer?: ReturnType<typeof setTimeout>
  private afterUserTranscript: Array<() => void> = []

  /**
   * The user started speaking.
   *
   * The assistant stops, and the audio read from the stream goes to the model.
   * A turn left open, because the sentence sounded unfinished, carries on.
   */
  startTurn(audio: Readable) {
    this.cancel()
    if (this.turn === 'none') this.turn = 'pending'
    audio.on('data', (chunk: Buffer) => this.sendAudio(chunk))
  }

  /** Closes the turn of the user, and has the model answer it */
  endTurn() {
    if (this.turn !== 'open') return
    this.turn = 'none'
    this.awaitUserTranscript()
    this.beginAnswer(true)
    this.closeTurn()
  }

  /** Drops the turn of the user, without an answer */
  discardTurn() {
    this.cancel()
    if (this.turn === 'open') {
      this.clearTurn()
      // A model that cannot drop audio answers it, and nobody wants to hear it
      this.discarding = true
    }
    this.turn = 'none'
  }

  /** Has the model speak without waiting for the user, to open a call */
  respond() {
    this.whenIdle(() => {
      this.beginAnswer(true)
      this.generate()
    })
  }

  /**
   * Has the model say this text, word for word.
   *
   * The caller records the text in the conversation, as with a text to speech,
   * so the transcript of what the model says is not recorded again.
   */
  say(text: string) {
    this.whenIdle(() => {
      this.beginAnswer(false)
      this.speakText(text)
    })
  }

  cancel() {
    this.queue = []
    const answer = this.currentAnswer
    if (!answer) return
    this.log('Cancel')
    this.currentAnswer = undefined
    this.discarding = true
    this.cancelAnswer()
    this.recordAnswer(answer)
    this.resolveAnswerWaiters()
  }

  /**
   * Adds a message the model did not hear, and tells the model about it.
   *
   * The transcripts of the call are recorded apart, so they are not sent back.
   */
  addMessage(
    role: 'user' | 'assistant' | 'system',
    text: string,
    metadata?: MicdropAnswerMetadata
  ) {
    super.addMessage(role, text, metadata)
    if (text.trim() !== '') this.injectMessage(role, text)
  }

  addTool<Schema extends z.ZodObject>(tool: Tool<Schema>) {
    super.addTool(tool)
    this.updateTools()
  }

  removeTool(name: string) {
    super.removeTool(name)
    this.updateTools()
  }

  /**
   * Lists the events that have listeners.
   *
   * Typed as the events of any agent, so a realtime model goes wherever an
   * agent is expected. The two extra events do not change what that code reads.
   */
  eventNames() {
    return super.eventNames() as Array<keyof AgentEvents>
  }

  destroy() {
    super.destroy()
    this.clearUserTranscriptTimer()
    this.afterUserTranscript = []
    this.resolveAnswerWaiters()
  }

  protected generateAnswer(stream: PassThrough): Promise<void> {
    let written = 0
    const onPartial = (transcript: string) => {
      stream.write(transcript.slice(written))
      written = transcript.length
    }
    this.on('PartialMessage', onPartial)
    this.respond()
    return new Promise((resolve) => {
      this.answerWaiters.push(() => {
        this.off('PartialMessage', onPartial)
        resolve()
      })
    })
  }

  /** Sends audio of the user, PCM16 at 16 kHz */
  protected abstract appendAudio(chunk: Buffer): void

  /** Opens a turn of the user, right before its first audio */
  protected abstract openTurn(): void

  /** Closes the turn of the user, which has the model answer it */
  protected abstract closeTurn(): void

  /** Drops the audio of the open turn, without an answer */
  protected abstract clearTurn(): void

  /** Has the model speak with no turn of the user to answer */
  protected abstract generate(): void

  /** Has the model say this text, word for word */
  protected abstract speakText(text: string): void

  /** Stops the answer the model is giving */
  protected abstract cancelAnswer(): void

  /** Sends the tools to the model again, after one was added or removed */
  protected abstract updateTools(): void

  /** Tells the model about a message it did not hear */
  protected abstract injectMessage(
    role: 'user' | 'assistant' | 'system',
    text: string
  ): void

  /** Nobody is speaking, nor about to, so the connection can be renewed */
  protected get isIdle(): boolean {
    return this.turn === 'none' && !this.currentAnswer
  }

  /** Voice of the answer, PCM16 at 16 kHz */
  protected emitAudio(chunk: Buffer) {
    const answer = this.activeAnswer()
    if (!answer) return
    answer.hasAudio = true
    this.emit('Audio', chunk)
  }

  /** Transcript of the answer, as it is spoken */
  protected addAnswerTranscript(text: string) {
    const answer = this.activeAnswer()
    if (!answer) return
    if (answer.resumed) {
      answer.resumed = false
      if (answer.transcript !== '' && !/\s$/.test(answer.transcript)) {
        text = ` ${text.trimStart()}`
      }
    }
    answer.transcript += text
    if (answer.record) this.emit('PartialMessage', answer.transcript)
  }

  /**
   * The model finished its answer, or finished dropping an interrupted one.
   *
   * An answer without audio tells the client to stop waiting for one.
   */
  protected endAnswer() {
    if (this.discarding) {
      this.discarding = false
      return
    }
    const answer = this.currentAnswer
    if (!answer) return
    this.currentAnswer = undefined
    if (!answer.hasAudio) this.emitAgentEvent('SkipAnswer')
    this.recordAnswer(answer)
    this.resolveAnswerWaiters()
    this.queue.shift()?.()
  }

  /** Runs a tool the model called, and records it in the conversation */
  protected async runTool(toolCall: MicdropConversationToolCall) {
    const result = await this.executeTool(toolCall)
    if (this.currentAnswer) this.currentAnswer.resumed = true
    return result
  }

  /** Transcript of the turn of the user, possibly in several pieces */
  protected addUserTranscript(text: string) {
    this.userTranscript += text
  }

  /** The transcript of the turn is complete, it goes in the conversation */
  protected commitUserTranscript() {
    this.clearUserTranscriptTimer()
    this.awaitingUserTranscript = false
    const text = this.userTranscript.trim()
    this.userTranscript = ''
    if (text !== '') super.addMessage('user', text)
    const pending = this.afterUserTranscript
    this.afterUserTranscript = []
    pending.forEach((record) => record())
  }

  private sendAudio(chunk: Buffer) {
    if (this.turn === 'none') return
    if (this.turn === 'pending') {
      this.turn = 'open'
      this.openTurn()
    }
    this.appendAudio(chunk)
  }

  private beginAnswer(record: boolean) {
    this.discarding = false
    this.currentAnswer = newAnswer(record)
  }

  /**
   * The answer output belongs to, if it is still wanted.
   *
   * The model can speak without being asked, to follow up on a tool call for
   * instance, which opens an answer of its own.
   */
  private activeAnswer(): RealtimeAnswer | undefined {
    if (this.discarding) return undefined
    if (!this.currentAnswer) this.currentAnswer = newAnswer(true)
    return this.currentAnswer
  }

  private whenIdle(start: () => void) {
    if (this.currentAnswer) {
      this.queue.push(start)
    } else {
      start()
    }
  }

  private recordAnswer(answer: RealtimeAnswer) {
    if (!answer.record) return
    const record = () => super.addMessage('assistant', answer.transcript.trim())
    if (this.awaitingUserTranscript) {
      this.afterUserTranscript.push(record)
    } else {
      record()
    }
  }

  private awaitUserTranscript() {
    this.awaitingUserTranscript = true
    this.clearUserTranscriptTimer()
    this.userTranscriptTimer = setTimeout(() => {
      this.log('No transcript of the turn, recording the answer anyway')
      this.commitUserTranscript()
    }, USER_TRANSCRIPT_TIMEOUT)
  }

  private clearUserTranscriptTimer() {
    if (!this.userTranscriptTimer) return
    clearTimeout(this.userTranscriptTimer)
    this.userTranscriptTimer = undefined
  }

  private resolveAnswerWaiters() {
    const waiters = this.answerWaiters
    this.answerWaiters = []
    waiters.forEach((resolve) => resolve())
  }
}

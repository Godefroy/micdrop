import { EventEmitter } from 'eventemitter3'
import { ECHO_TAIL, Mic, MicRecorder, Speaker, VAD, VADConfig } from '../audio'
import { pcm16ToArrayBuffer } from '../audio/pcm'
import { MicdropDevice } from '../audio/types'
import { MicdropStorageKeys, storage } from '../storage'
import {
  MicdropClassification,
  MicdropClientCommands,
  MicdropConversation,
  MicdropConversationItem,
  MicdropServerCommands,
  MicdropToolCall,
  TurnDetector,
} from '../types'
import {
  getClientErrorFromWSCloseEvent,
  isRecoverableError,
  MicdropClientError,
  MicdropClientErrorCode,
  WSCloseEvent,
} from './MicdropClientError'
import { EchoGuard, EchoStage } from './EchoGuard'

export interface MicdropEvents {
  EndCall: []
  Error: [MicdropClientError]
  StateChange: [MicdropState, MicdropState]
  ToolCall: [MicdropToolCall]
  /** A message was added to the conversation, by the user or the assistant */
  Message: [MicdropConversationItem]
  /** What the assistant is answering, before it is finished */
  PartialAssistantMessage: [string]
  /** What the classifier of the server made of what the user says */
  Classification: [MicdropClassification]
}

export interface MicdropReconnectOptions {
  maxAttempts?: number
  delayMs?: number
  connectionTimeout?: number
}

export interface MicdropOptions {
  url?: string
  params?: Record<string, any>
  vad?: VADConfig
  /**
   * Holds the turn open while the sentence sounds unfinished, so a hesitation
   * no longer counts as the end of a question. Without one, a turn ends as
   * soon as the VAD hears enough silence.
   */
  turnDetector?: TurnDetector
  /** How long a turn may stay open after the detector asked to wait */
  turnMaxWait?: number
  /**
   * Keeps the user from interrupting the assistant, whose voice they cannot
   * speak over. Forced on when the microphone has no echo cancellation, and
   * by the call itself when the assistant keeps cutting itself off.
   */
  disableInterruption?: boolean
  debugLog?: boolean
  reconnect?: MicdropReconnectOptions
}

/**
 * Where the call stands.
 *
 * - `stopped`: no call, the microphone may still be on for a test
 * - `starting`: opening the microphone and the connection
 * - `started`: the call is on
 * - `reconnecting`: the connection dropped, the call waits for a new one
 */
export type MicdropStatus = 'stopped' | 'starting' | 'started' | 'reconnecting'

/**
 * Who has the floor, one at a time.
 *
 * - `idle`: nothing is heard nor awaited, when stopped, paused or muted
 * - `listening`: waiting for the user to speak
 * - `userSpeaking`: the user speaks
 * - `processing`: the server prepares the answer
 * - `assistantSpeaking`: the answer is playing
 */
export type MicdropActivity =
  'idle' | 'listening' | 'userSpeaking' | 'processing' | 'assistantSpeaking'

export interface MicdropState {
  /** Where the call stands, which `isStarting`, `isStarted` and `isReconnecting` spell out */
  status: MicdropStatus
  /** Who has the floor, which `isListening`, `isUserSpeaking`, `isProcessing` and `isAssistantSpeaking` spell out */
  activity: MicdropActivity
  isStarting: boolean
  isStarted: boolean
  isMuted: boolean
  isPaused: boolean
  isReconnecting: boolean
  isListening: boolean
  isProcessing: boolean
  isUserSpeaking: boolean
  isAssistantSpeaking: boolean
  isMicStarted: boolean
  isMicMuted: boolean
  micDeviceId: string | undefined
  speakerDeviceId: string | undefined
  micDevices: MicdropDevice[]
  speakerDevices: MicdropDevice[]
  conversation: MicdropConversation
  /**
   * Answer being written, sent by servers configured with `partialMessages`.
   * Empty the rest of the time, and replaced by a conversation message once
   * the answer is finished.
   */
  partialAssistantMessage: string
  error: MicdropClientError | undefined
}

const DEFAULT_RECONNECT_OPTIONS: Required<MicdropReconnectOptions> = {
  maxAttempts: Infinity,
  delayMs: 1000,
  connectionTimeout: 5000,
}

export class MicdropClient
  extends EventEmitter<MicdropEvents>
  implements MicdropState
{
  public micRecorder?: MicRecorder
  public conversation: MicdropConversation = []
  public partialAssistantMessage = ''
  public error: MicdropClientError | undefined
  public speakerDevices: MicdropDevice[] = []
  public micDevices: MicdropDevice[] = []

  private ws?: WebSocket
  private startTime = 0
  private lastNotifiedState = this.state
  private _isProcessing = false
  private _isMuted = false
  private _isPaused = false
  // The call as start() and the connection leave it. The public status also
  // weighs the microphone, which a device change restarts during a call.
  private callStatus: MicdropStatus = 'stopped'
  private reconnectAttempt = 0
  private reconnectTimer?: ReturnType<typeof setTimeout>
  private connectionTimer?: ReturnType<typeof setTimeout>
  private echoGuard = new EchoGuard()
  // Waiting for the answer to end before stopping, see stopAfterAnswer()
  private pendingStop?: () => void

  constructor(public options: MicdropOptions = {}) {
    super()

    // Add speaker listener
    Speaker.on('StartPlaying', this.onSpeakerStartPlaying)
    Speaker.on('StopPlaying', this.onSpeakerStopPlaying)

    // Refresh the lists when the user plugs a headset in
    Mic.on('DeviceChange', this.updateDevices)
  }

  get vad(): VAD | undefined {
    return this.micRecorder?.vad
  }

  get status(): MicdropStatus {
    const mic = this.micRecorder?.state
    if (this.callStatus === 'reconnecting') return 'reconnecting'
    if (this.callStatus === 'started' && mic?.isStarted) return 'started'
    // Opening the microphone can take a while, for the permission prompt or
    // the browser itself, and a device change restarts it during a call
    if (this.callStatus !== 'stopped' || mic?.isStarting) return 'starting'
    return 'stopped'
  }

  get activity(): MicdropActivity {
    if (this.isUserSpeaking) return 'userSpeaking'
    if (this.isAssistantSpeaking) return 'assistantSpeaking'
    if (this.isProcessing) return 'processing'
    if (this.isListening) return 'listening'
    return 'idle'
  }

  /** The call is on, reconnecting included */
  get isStarted(): boolean {
    const status = this.status
    return status === 'started' || status === 'reconnecting'
  }

  get isStarting(): boolean {
    return this.status === 'starting'
  }

  get isReconnecting(): boolean {
    return this.status === 'reconnecting'
  }

  get isMuted(): boolean {
    return this._isMuted
  }

  get isPaused(): boolean {
    return this._isPaused
  }

  get isProcessing(): boolean {
    return this._isProcessing && !this.isPaused
  }

  get isListening(): boolean {
    return (
      this.isMicStarted &&
      !this.isPaused &&
      !this.isProcessing &&
      !this.isMicMuted &&
      !this.isUserSpeaking &&
      !this.isAssistantSpeaking
    )
  }

  get isWSStarted(): boolean {
    return this.ws?.readyState === 1 // WebSocket.OPEN
  }

  get isWSStarting(): boolean {
    return this.ws?.readyState === 0 // WebSocket.CONNECTING
  }

  get isMicStarted(): boolean {
    return Mic.isStarted
  }

  get isMicMuted(): boolean {
    return this.vad?.isPaused ?? false
  }

  get isUserSpeaking(): boolean {
    return this.micRecorder?.state.isSpeaking ?? false
  }

  get isAssistantSpeaking(): boolean {
    return Speaker.isPlaying
  }

  /**
   * Whether the user is kept from speaking over the assistant. Without echo
   * cancellation the microphone hears the assistant, which would interrupt
   * itself and end up in the transcript. A call also gets here on its own when
   * the assistant keeps cutting itself off, see {@link EchoGuard}.
   */
  get isInterruptionDisabled(): boolean {
    return (
      !!this.options.disableInterruption ||
      Mic.echoCancellation === false ||
      this.echoGuard.stage === 'disabled'
    )
  }

  /** How far this call has gone to keep the assistant out of the microphone */
  get echoStage(): EchoStage {
    return this.echoGuard.stage
  }

  get micDeviceId(): string | undefined {
    return Mic.deviceId
  }

  get speakerDeviceId(): string | undefined {
    return Speaker.deviceId
  }

  get state(): MicdropState {
    return {
      status: this.status,
      activity: this.activity,
      isStarting: this.isStarting,
      isStarted: this.isStarted,
      isReconnecting: this.isReconnecting,
      isMuted: this.isMuted,
      isPaused: this.isPaused,
      isListening: this.isListening,
      isProcessing: this.isProcessing,
      isUserSpeaking: this.isUserSpeaking,
      isAssistantSpeaking: this.isAssistantSpeaking,
      isMicStarted: this.isMicStarted,
      isMicMuted: this.isMicMuted,
      conversation: this.conversation,
      partialAssistantMessage: this.partialAssistantMessage,
      error: this.error,
      micDeviceId: this.micDeviceId,
      speakerDeviceId: this.speakerDeviceId,
      micDevices: this.micDevices,
      speakerDevices: this.speakerDevices,
    }
  }

  start = async (options: MicdropOptions) => {
    // A stop waiting for the previous answer is no longer wanted
    this.cancelPendingStop()
    this.error = undefined
    this.options = { ...this.options, ...options }

    // Reset state
    this.startTime = Date.now()
    this.conversation = []
    this.partialAssistantMessage = ''
    this._isProcessing = true
    this._isMuted = false
    this._isPaused = false
    this.callStatus = 'starting'
    this.reconnectAttempt = 0
    this.clearReconnectTimer()
    this.notifyStateChange()

    try {
      // Start mic if not already started
      if (!this.micRecorder || options?.vad) {
        await this.startMic({ vad: options?.vad })
      }
      // Stopped while the microphone was opening
      if (this.callStatus !== 'starting') return
      this.openWS()
    } catch (error) {
      // A refused microphone has already stopped the call and said why
      if ((this.callStatus as MicdropStatus) !== 'stopped') {
        this.setError(toClientError(error))
        await this.stop()
      }
      throw error
    }

    // Already connected, the socket was kept from a previous start
    if (this.isWSStarted) {
      this.callStatus = 'started'
      this.notifyStateChange()
    }
  }

  stop = async () => {
    this.cancelPendingStop()
    this.partialAssistantMessage = ''
    this.callStatus = 'stopped'
    this._isProcessing = false
    this._isMuted = false
    this._isPaused = false
    this.clearReconnectTimer()

    try {
      // Stop websocket
      this.stopWS()
    } catch (error) {
      console.error('[MicdropClient] Error stopping WebSocket', error)
    }

    // Stop speaker, before the microphone releases the audio session
    Speaker.stopAudio()

    // What a call learned about the echo may not hold for the next one
    this.echoGuard.reset()
    Speaker.resetEchoFallback()

    try {
      // Stop microphone
      await this.stopMic()
    } catch (error) {
      console.error('[MicdropClient] Error stopping microphone', error)
    }
  }

  /** The assistant prepares or speaks an answer */
  private get isAnswering(): boolean {
    const { activity } = this
    return activity === 'processing' || activity === 'assistantSpeaking'
  }

  /**
   * Stops the call once the assistant finished its answer, the one it is
   * still preparing included, such as the goodbye that follows an `EndCall`.
   * Stops right away when no answer is under way.
   *
   * A `start()` or a `stop()` meanwhile cancels the wait, so it never acts on
   * the next call.
   * @returns Resolves once the call is stopped, or the wait cancelled
   */
  stopAfterAnswer = async (): Promise<void> => {
    if (!this.isAnswering) return this.stop()
    this.cancelPendingStop()
    return new Promise((resolve) => {
      const detach = () => {
        this.off('StateChange', onStateChange)
        this.pendingStop = undefined
      }
      const onStateChange = () => {
        if (this.isAnswering) return
        detach()
        this.stop().then(resolve)
      }
      this.on('StateChange', onStateChange)
      this.pendingStop = () => {
        detach()
        resolve()
      }
    })
  }

  private cancelPendingStop() {
    this.pendingStop?.()
  }

  mute = () => {
    this.vad?.pause()
    this._isMuted = true
    this.notifyStateChange()
  }

  unmute = () => {
    if (!this.isPaused && !(this.isInterruptionDisabled && Speaker.isPlaying)) {
      this.vad?.resume()
    }
    this._isMuted = false
    this.notifyStateChange()
  }

  pause = () => {
    if (this.isPaused) return
    this.vad?.pause()
    this._isPaused = true
    this._isProcessing = false
    this.notifyStateChange()
    Speaker.stopAudio()
    this.ws?.send(MicdropClientCommands.Mute)
  }

  resume = () => {
    if (!this.isPaused) return
    if (!this.isMuted) {
      this.vad?.resume()
    }
    this._isPaused = false
    this.notifyStateChange()
  }

  startMic = async (
    options: {
      vad?: VADConfig
      deviceId?: string
    } = {}
  ) => {
    this.error = undefined
    this._isMuted = false
    if (options.vad) {
      this.options.vad = options.vad
    }
    try {
      if (this.micRecorder) {
        // Stop previous recorder
        this.micRecorder.stop()

        // Change VAD if needed
        if (options.vad) {
          this.micRecorder.changeVad(options.vad)
        }
      } else {
        this.micRecorder = new MicRecorder(
          this.options.vad,
          this.options.turnDetector,
          this.options.turnMaxWait
        )
        this.micRecorder.setSpeakerPlaying(
          this.isInterruptionDisabled && Speaker.isPlaying
        )

        this.micRecorder.isEcho = this.isEchoOfAssistant

        // Notify mic recorder state change
        this.micRecorder.on('StateChange', () => {
          this.notifyStateChange()
        })

        // Send chunk of user speech to server
        this.micRecorder.on('Chunk', (chunk) => {
          this.log('User audio chunk', chunk.length)
          this.ws?.send(pcm16ToArrayBuffer(chunk))
        })

        // Notify server that user started speaking
        this.micRecorder.on('StartSpeaking', () => {
          this.log('User start speaking')
          this.ws?.send(MicdropClientCommands.StartSpeaking)
          // Interruption
          this.partialAssistantMessage = ''
          this._isProcessing = false
          this.notifyStateChange()
          Speaker.stopAudio()
        })

        // Notify server that user speech is complete
        this.micRecorder.on('StopSpeaking', () => {
          this.log('User stop speaking')
          this.ws?.send(MicdropClientCommands.StopSpeaking)
          if (this.isWSStarted) {
            this._isProcessing = true
          }
          this.notifyStateChange()
        })
      }

      // Start microphone, on the input chosen last time when none is given
      const deviceId =
        options.deviceId ??
        storage.getItem(MicdropStorageKeys.MicDevice) ??
        undefined
      const recorder = this.micRecorder
      await Mic.start(deviceId)
      // Stopped while the microphone was opening, a hang-up during the
      // permission prompt for instance: there is nothing left to start
      if (this.micRecorder !== recorder || !Mic.isStarted) return
      if (Mic.deviceId) {
        storage.setItem(MicdropStorageKeys.MicDevice, Mic.deviceId)
      } else {
        storage.removeItem(MicdropStorageKeys.MicDevice)
      }

      if (Mic.echoCancellation === false && !this.options.disableInterruption) {
        this.log('No echo cancellation, interruptions are disabled')
      }

      // Start recorder
      await this.micRecorder.start(Mic)

      // Start speaker
      await Speaker.start()

      // Get devices after starting the mic, the OS only lists them once the
      // audio session is active
      await this.updateDevices()

      this.notifyStateChange()
    } catch (error) {
      this.setError(
        new MicdropClientError(
          MicdropClientErrorCode.Mic,
          (error as any)?.message
        )
      )
      await this.stop()
      throw error
    }
  }

  /**
   * Changes what decides when a turn is over, during a call or before one
   * @param turnDetector - The new detector, or nothing to leave it to the VAD
   */
  setTurnDetector = (turnDetector?: TurnDetector) => {
    this.options.turnDetector = turnDetector
    this.micRecorder?.changeTurnDetector(turnDetector)
  }

  /**
   * Says how long a held turn waits for the rest of the sentence.
   *
   * The way out of a wrong verdict: a detector can hear an unfinished sentence
   * where there is none, and the speaker who never comes back still gets an
   * answer once this runs out.
   * @param milliseconds - How long to wait past the detector asking to
   */
  setTurnMaxWait = (milliseconds: number) => {
    this.options.turnMaxWait = milliseconds
    if (this.micRecorder) {
      this.micRecorder.turnMaxWait = milliseconds
    }
  }

  changeMicDevice = async (deviceId: string) => {
    await this.startMic({ deviceId })
  }

  changeSpeakerDevice = async (deviceId: string) => {
    await Speaker.changeDevice(deviceId)
    this.notifyStateChange()
  }

  private async stopMic() {
    this.micRecorder?.stop()
    this.micRecorder = undefined
    await Mic.stop()
    this.notifyStateChange()
  }

  private updateDevices = async () => {
    const [micDevices, speakerDevices] = await Promise.all([
      Mic.getDevices(),
      Speaker.getDevices(),
    ])
    this.micDevices = micDevices
    this.speakerDevices = speakerDevices
    this.notifyStateChange()
  }

  /**
   * Opens the connection, unless one is already open or opening.
   *
   * The socket answers through handlers bound to it, so one left behind by a
   * stop or a reconnection never acts on the call that followed.
   */
  private openWS() {
    if (this.ws) {
      this.log('WebSocket is already started')
      return
    }
    if (!this.isMicStarted) {
      throw new MicdropClientError(MicdropClientErrorCode.Mic)
    }
    if (!this.options.url) {
      throw new MicdropClientError(MicdropClientErrorCode.MissingUrl)
    }

    const ws = new WebSocket(this.options.url)
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    this.notifyStateChange()

    const isCurrent = () => this.ws === ws
    ws.onopen = () => isCurrent() && this.onWSOpen()
    ws.onmessage = (event) => isCurrent() && this.onWSMessage(event)
    ws.onclose = (event) => isCurrent() && this.onWSClose(event)
    ws.onerror = () => isCurrent() && this.onWSError()

    // Connection timeout
    this.connectionTimer = setTimeout(() => {
      this.connectionTimer = undefined
      if (isCurrent() && ws.readyState === 0) {
        this.log('WebSocket connection timeout')
        ws.close()
      }
    }, this.options.reconnect?.connectionTimeout ?? DEFAULT_RECONNECT_OPTIONS.connectionTimeout)
  }

  private onWSOpen = () => {
    this.log('WebSocket opened')
    if (this.connectionTimer) {
      clearTimeout(this.connectionTimer)
      this.connectionTimer = undefined
    }
    this.callStatus = 'started'
    this.reconnectAttempt = 0
    this.error = undefined
    this.notifyStateChange()

    // Send params
    if (this.options.params) {
      this.ws?.send(JSON.stringify(this.options.params))
    }

    // Resume VAD if we paused while offline
    if (!this.isPaused && !this.isMuted) {
      this.vad?.resume?.()
    }
  }

  private onWSMessage = (event: MessageEvent) => {
    const data = event.data

    if (data instanceof ArrayBuffer) {
      // Received assistant speech
      this.log('Received audio', data.byteLength)
      if (this.isPaused || this.isUserSpeaking) return
      Speaker.playAudio(new Int16Array(data))
      this._isProcessing = false
      this.notifyStateChange()
      return
    }

    if (typeof data !== 'string') {
      console.warn(`[MicdropClient] Unknown message type: ${data}`)
      return
    }

    this.log('Received message:', data)

    if (data.startsWith(MicdropServerCommands.Message)) {
      // Received user/assistant message
      try {
        const message = JSON.parse(
          data.substring(MicdropServerCommands.Message.length + 1)
        )
        this.addMessage(message)
      } catch (error) {
        console.error('[MicdropClient] Error parsing message:', data, error)
      }
    } else if (data.startsWith(MicdropServerCommands.PartialAssistantMessage)) {
      // The answer is still being written
      this.setPartialAssistantMessage(data)
    } else if (data === MicdropServerCommands.EndCall) {
      // Call ended
      this.emit('EndCall')
    } else if (data === MicdropServerCommands.SkipAnswer) {
      // Answer was skipped, listen again
      this.partialAssistantMessage = ''
      this._isProcessing = false
      this.notifyStateChange()
    } else if (data === MicdropServerCommands.CancelLastUserMessage) {
      // Remove last user message if aborted
      const lastMessage = this.conversation
        .map((message) => message.role)
        .lastIndexOf('user')
      if (lastMessage !== -1) {
        this.conversation = this.conversation.filter(
          (_, index) => index !== lastMessage
        )
        this._isProcessing = false
        this.notifyStateChange()
      }
    } else if (data.startsWith(MicdropServerCommands.ToolCall)) {
      // Received tool call information
      try {
        const toolCall = JSON.parse(
          data.substring(MicdropServerCommands.ToolCall.length + 1)
        )
        this.emit('ToolCall', toolCall)
      } catch (error) {
        console.error('[MicdropClient] Error parsing tool call:', data, error)
      }
    } else if (data.startsWith(MicdropServerCommands.Classification)) {
      // Received what the classifier made of the user turn
      try {
        const classification = JSON.parse(
          data.substring(MicdropServerCommands.Classification.length + 1)
        )
        this.emit('Classification', classification)
      } catch (error) {
        console.error(
          '[MicdropClient] Error parsing classification:',
          data,
          error
        )
      }
    }
  }

  private onWSClose = (event: WSCloseEvent) => {
    this.log('WebSocket closed', event?.code, event?.reason)
    const error = getClientErrorFromWSCloseEvent(event ?? {})
    if (error) {
      this.setError(error)
    }

    const config = { ...DEFAULT_RECONNECT_OPTIONS, ...this.options.reconnect }
    const canReconnect =
      error && isRecoverableError(error) && config.maxAttempts > 0

    if (canReconnect) {
      this.callStatus = 'reconnecting'
      this.stopWS()
      this.scheduleReconnect(config)
    } else {
      this.stop()
    }
  }

  private onWSError = () => {
    this.setError(new MicdropClientError(MicdropClientErrorCode.Connection))
  }

  private stopWS() {
    if (this.connectionTimer) {
      clearTimeout(this.connectionTimer)
      this.connectionTimer = undefined
    }
    const ws = this.ws
    if (!ws) return
    // Forgotten before it closes, so its close event finds nobody to act on
    this.ws = undefined
    if (ws.readyState === 1 || ws.readyState === 0) {
      ws.close()
    }
    this.notifyStateChange()
  }

  private scheduleReconnect(config: Required<MicdropReconnectOptions>) {
    if (this.callStatus !== 'reconnecting') return
    if (this.reconnectAttempt >= config.maxAttempts) {
      this.stop()
      this.setError(new MicdropClientError(MicdropClientErrorCode.Connection))
      return
    }

    this.reconnectAttempt++
    this.log(
      `Reconnecting in ${config.delayMs}ms (attempt ${this.reconnectAttempt})`
    )

    // Pause VAD while offline to avoid capturing audio that cannot be sent
    if (!this.isPaused && !this.isMuted) {
      this.vad?.pause?.()
    }

    this.clearReconnectTimer()
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      // Stopped meanwhile
      if (this.callStatus !== 'reconnecting') return
      try {
        this.openWS()
      } catch (error) {
        // Nothing a new attempt would change, a bad address for instance
        this.setError(toClientError(error))
        this.stop()
      }
    }, config.delayMs)
  }

  private clearReconnectTimer() {
    if (!this.reconnectTimer) return
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
  }

  private onSpeakerStartPlaying = () => {
    this.log('Speaker started')
    // A speaker test before the call says nothing about the call
    if (this.isWSStarted) {
      this.echoGuard.speakerStarted(Date.now())
    }
    // Interrupting relies on echo cancellation to keep the assistant out of
    // the recording. Without it, what the speaker plays is left out.
    if (this.isInterruptionDisabled) {
      this.micRecorder?.setSpeakerPlaying(true)
      this.vad?.pause()
    }
    this.notifyStateChange()
  }

  private onSpeakerStopPlaying = () => {
    this.log('Speaker stopped')
    this.echoGuard.speakerStopped(Date.now())
    this.micRecorder?.setSpeakerPlaying(false)
    if (this.isInterruptionDisabled) {
      setTimeout(() => {
        if (!this.isMuted) {
          this.vad?.resume()
          this.notifyStateChange()
        }
        // Wait for the echo of the speaker to die out
      }, ECHO_TAIL)
    } else {
      this.notifyStateChange()
    }
  }

  /**
   * Treats speech heard just as the assistant starts as its echo, and steps up
   * what keeps it out of the microphone. The interruption never happens, so
   * neither the speaker nor the server hear of it.
   */
  private isEchoOfAssistant = () => {
    if (this.isInterruptionDisabled || !Speaker.isPlaying) return false
    if (!this.echoGuard.speechHeard(Date.now())) return false

    this.log('Echo of the assistant, moving to', this.echoGuard.stage)
    if (this.echoGuard.stage === 'fallback') {
      Speaker.useEchoFallback().then((moved) => {
        if (!moved && this.echoGuard.stage === 'fallback') {
          this.echoGuard.stage = 'disabled'
          this.onInterruptionsGivenUp()
        }
      })
    } else {
      this.onInterruptionsGivenUp()
    }
    this.notifyStateChange()
    return true
  }

  // The same as when the speaker starts on a call without interruptions
  private onInterruptionsGivenUp() {
    this.log('Interruptions disabled until the end of the call')
    if (Speaker.isPlaying) {
      this.micRecorder?.setSpeakerPlaying(true)
      this.vad?.pause()
    }
    this.notifyStateChange()
  }

  private addMessage(message: MicdropConversationItem) {
    // The settled answer takes the place of the one being written
    if (message.role === 'assistant') this.partialAssistantMessage = ''
    this.conversation = [...this.conversation, message]
    this.notifyStateChange()
    this.emit('Message', message)
  }

  private setPartialAssistantMessage(data: string) {
    const command = MicdropServerCommands.PartialAssistantMessage
    let content: string
    try {
      content = JSON.parse(data.substring(command.length + 1))
    } catch (error) {
      console.error('[MicdropClient] Error parsing partial answer:', data)
      return
    }
    this.partialAssistantMessage = content
    this.emit('PartialAssistantMessage', content)
    this.notifyStateChange()
  }

  private setError(error: MicdropClientError) {
    console.error('[MicdropClient] Error:', error)
    this.error = error
    this.notifyStateChange()
    this.emit('Error', error)
  }

  private notifyStateChange() {
    const state = this.state
    this.emit('StateChange', state, this.lastNotifiedState)
    this.lastNotifiedState = state
  }

  private log(...message: any[]) {
    if (!this.options.debugLog) return
    console.log(`[MicdropClient ${Date.now() - this.startTime}]`, ...message)
  }
}

/**
 * A missing address or a refused microphone already says what went wrong,
 * only an unnamed failure is reported as a connection error
 */
function toClientError(error: unknown): MicdropClientError {
  if (error instanceof MicdropClientError) return error
  return new MicdropClientError(
    MicdropClientErrorCode.Connection,
    (error as any)?.message
  )
}

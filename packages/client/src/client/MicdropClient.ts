import { EventEmitter } from 'eventemitter3'
import { Mic, MicRecorder, Speaker, VAD, VADConfig } from '../audio'
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
  disableInterruption?: boolean
  debugLog?: boolean
  reconnect?: MicdropReconnectOptions
}

export interface MicdropState {
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
  private _isReconnecting = false
  // From start() until the connection opens, the microphone included: opening
  // it can take a while, for the permission prompt or the browser itself
  private _isStartingCall = false
  private reconnectAttempt = 0
  private reconnectTimer?: ReturnType<typeof setTimeout>
  private connectionTimer?: ReturnType<typeof setTimeout>

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

  get isStarted(): boolean {
    return (
      (this.isWSStarted || this._isReconnecting) &&
      (this.micRecorder?.state.isStarted || false)
    )
  }

  get isStarting(): boolean {
    return (
      (this._isStartingCall ||
        this.isWSStarting ||
        this.micRecorder?.state.isStarting ||
        false) &&
      !this._isReconnecting
    )
  }

  get isReconnecting(): boolean {
    return this._isReconnecting
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

  get micDeviceId(): string | undefined {
    return Mic.deviceId
  }

  get speakerDeviceId(): string | undefined {
    return Speaker.deviceId
  }

  get state(): MicdropState {
    return {
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
    this.error = undefined
    this.options = { ...this.options, ...options }

    // Reset state
    this.startTime = Date.now()
    this.conversation = []
    this.partialAssistantMessage = ''
    this._isProcessing = true
    this._isMuted = false
    this._isPaused = false
    this._isReconnecting = false
    this._isStartingCall = true
    this.reconnectAttempt = 0
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }
    this.notifyStateChange()

    // Start mic if not already started
    if (!this.micRecorder || options?.vad) {
      await this.startMic({ vad: options?.vad })
    }

    // Start websocket
    await this.startWS()

    // Already connected, the socket was kept from a previous start
    if (this.isWSStarted && this._isStartingCall) {
      this._isStartingCall = false
      this.notifyStateChange()
    }
  }

  stop = async () => {
    this.partialAssistantMessage = ''
    this._isStartingCall = false
    this._isProcessing = false
    this._isMuted = false
    this._isPaused = false
    this._isReconnecting = false
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }

    try {
      // Stop websocket
      this.stopWS()
    } catch (error) {
      console.error('[MicdropClient] Error stopping WebSocket', error)
    }

    // Stop speaker, before the microphone releases the audio session
    Speaker.stopAudio()

    try {
      // Stop microphone
      await this.stopMic()
    } catch (error) {
      console.error('[MicdropClient] Error stopping microphone', error)
    }
  }

  mute = () => {
    this.vad?.pause()
    this._isMuted = true
    this.notifyStateChange()
  }

  unmute = () => {
    if (
      !this.isPaused &&
      !(this.options.disableInterruption && Speaker.isPlaying)
    ) {
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
      await Mic.start(deviceId)
      if (Mic.deviceId) {
        storage.setItem(MicdropStorageKeys.MicDevice, Mic.deviceId)
      } else {
        storage.removeItem(MicdropStorageKeys.MicDevice)
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

  private async startWS() {
    try {
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

      // Start websocket
      this.ws = new WebSocket(this.options.url)
      this.ws.binaryType = 'arraybuffer'
      this.notifyStateChange()

      // Events
      this.ws.onopen = this.onWSOpen
      this.ws.onmessage = this.onWSMessage
      this.ws.onclose = this.onWSClose
      this.ws.onerror = this.onWSError

      // Connection timeout
      this.connectionTimer = setTimeout(() => {
        this.connectionTimer = undefined
        if (this.ws?.readyState === 0) {
          this.log('WebSocket connection timeout')
          this.ws.close()
        }
      }, this.options.reconnect?.connectionTimeout ?? DEFAULT_RECONNECT_OPTIONS.connectionTimeout)
    } catch (error) {
      // A missing address or a refused microphone already says what went
      // wrong, only an unnamed failure is reported as a connection error
      this.setError(
        error instanceof MicdropClientError
          ? error
          : new MicdropClientError(
              MicdropClientErrorCode.Connection,
              (error as any)?.message
            )
      )
      await this.stop()
      throw error
    }
  }

  private onWSOpen = () => {
    this.log('WebSocket opened')
    if (this.connectionTimer) {
      clearTimeout(this.connectionTimer)
      this.connectionTimer = undefined
    }
    this._isReconnecting = false
    this._isStartingCall = false
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
      this._isReconnecting = true
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
    if (!this.ws) return
    if (this.ws.readyState === 1 || this.ws.readyState === 0) {
      this.ws.close()
    }
    this.ws = undefined
    this.notifyStateChange()
  }

  private scheduleReconnect(config: Required<MicdropReconnectOptions>) {
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

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
    }

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.startWS()
      } catch {
        this.scheduleReconnect(config)
      }
    }, config.delayMs)
  }

  private onSpeakerStartPlaying = () => {
    this.log('Speaker started')
    if (this.options.disableInterruption) {
      this.vad?.pause()
    }
    this.notifyStateChange()
  }

  private onSpeakerStopPlaying = () => {
    this.log('Speaker stopped')
    if (this.options.disableInterruption) {
      setTimeout(() => {
        if (!this.isMuted) {
          this.vad?.resume()
          this.notifyStateChange()
        }
        // Wait a bit to avoid recording the speaker output
      }, 200)
    } else {
      this.notifyStateChange()
    }
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

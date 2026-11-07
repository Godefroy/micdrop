import {
  ReconnectingSocket,
  ReconnectingSocketHandshake,
  ReconnectingSocketStatus,
} from '@micdrop/server'
import { EventEmitter } from 'eventemitter3'
import type { RawData } from 'ws'

/**
 * A connection to the Gemini Live API, shared by GeminiLive and GeminiSTT
 *
 * @see https://ai.google.dev/gemini-api/docs/live-api
 *
 * The connection itself, its attempts, retries and timeouts, is a
 * ReconnectingSocket. This class adds what belongs to Gemini: the setup that
 * opens each session, the messages held until the session is ready, and the
 * pacing of the end of a turn. What a new session has to know is left to the
 * owner, told by the events.
 */

export interface LiveSocketOptions {
  apiKey: string
  connectionTimeout?: number
  retryDelay?: number
  maxRetry?: number
}

export interface LiveSocketEvents {
  /**
   * The session is set up, right before the messages waiting for it go out.
   * Carries the setup that opened it, which tells whether it resumed a
   * previous session.
   */
  Ready: [setup: any]
  Message: [any]
  /** The connection dropped, attempt number of the new one to come */
  Reconnecting: [number]
  /** No connection could be restored, and the messages waiting are dropped */
  Failed: []
}

const URL =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent'
const SAMPLE_RATE = 16000 // Rate of the audio sent, the one of the Micdrop client
const BYTES_PER_MS = (SAMPLE_RATE * 2) / 1000

export class LiveSocket extends EventEmitter<LiveSocketEvents> {
  private socket: ReconnectingSocket
  // Messages waiting for the session, or for the end of a turn to be due
  private pending: any[] = []
  private pendingTimeout?: NodeJS.Timeout
  // Audio of the turn as it went out, see flush()
  private turnAudioStartedAt = 0
  private turnAudioMs = 0
  // Attempts since the last session was ready, for the owner to tell a drop
  // from a resumption that keeps failing
  private reconnectAttempts = 0
  // Setup sent by the handshake of the connection being opened
  private setup?: object

  constructor(
    options: LiveSocketOptions,
    private readonly buildSetup: () => object,
    private readonly log: (...message: any[]) => void
  ) {
    super()
    this.socket = new ReconnectingSocket({
      url: `${URL}?key=${encodeURIComponent(options.apiKey)}`,
      connectionTimeout: options.connectionTimeout,
      retryDelay: options.retryDelay,
      maxRetry: options.maxRetry,
      handshake: this.handshake,
      log,
    })
    this.socket.on('Open', this.onOpen)
    this.socket.on('Message', this.onMessage)
    this.socket.on('StatusChange', this.onStatusChange)
    this.socket.on('Failed', this.onFailed)
  }

  /** The session is set up and takes messages right away */
  get isConnected(): boolean {
    return this.socket.isOpen
  }

  connect() {
    this.socket.connect()
  }

  /**
   * Sends a message once the session is ready, after the ones before it.
   * Dropped once the connection failed for good, as nothing would send it.
   */
  send(message: any) {
    const status = this.socket.status
    if (status === 'failed' || status === 'destroyed') return
    this.pending.push(message)
    this.flush()
  }

  /** Sends a message ahead of the waiting ones, from a Ready listener */
  sendFirst(message: any) {
    this.socket.send(JSON.stringify(message))
  }

  /** Drops the messages that have not gone out */
  clearPending() {
    this.pending = []
    this.clearPendingTimeout()
  }

  /**
   * Moves to a new connection, keeping the messages that have not gone out.
   * A reconnection waiting for its delay is replaced by this one.
   */
  renew() {
    this.log('Renewing the connection')
    this.clearPendingTimeout()
    this.reconnectAttempts = 0
    this.socket.restart()
  }

  destroy() {
    this.clearPending()
    this.socket.destroy()
    this.removeAllListeners()
  }

  /** Sends the setup, and holds the connection back until Gemini accepts it */
  private handshake: ReconnectingSocketHandshake = {
    start: (socket) => {
      const setup = this.buildSetup()
      this.setup = setup
      socket.send(JSON.stringify(setup))
    },
    read: (data) => !!parseMessage(data.toString())?.setupComplete,
  }

  private onOpen = () => {
    this.log('Session ready')
    this.reconnectAttempts = 0
    this.emit('Ready', this.setup)
    this.flush()
  }

  private onMessage = (data: RawData) => {
    const message = parseMessage(data.toString())
    if (message) this.emit('Message', message)
  }

  private onStatusChange = (status: ReconnectingSocketStatus) => {
    // An end of turn waiting for its audio waits for the next session instead
    if (status !== 'open') this.clearPendingTimeout()
    if (status === 'reconnecting') {
      this.emit('Reconnecting', ++this.reconnectAttempts)
    }
  }

  private onFailed = () => {
    this.clearPending()
    this.emit('Failed')
  }

  /**
   * Sends the messages in order, as soon as they can go.
   *
   * Gemini refuses the end of a turn that comes before the audio of the turn
   * had time to play, and closes the session. Audio sent faster than it is
   * spoken, when the user talked while the connection opened, would end the
   * session, so the end of such a turn waits for it.
   */
  private flush() {
    while (this.pending.length > 0 && !this.pendingTimeout) {
      if (!this.socket.isOpen) return
      const message = this.pending[0]
      const input = message.realtimeInput

      if (input?.activityEnd) {
        const due = this.turnAudioStartedAt + this.turnAudioMs - Date.now()
        if (due > 0) {
          this.pendingTimeout = setTimeout(() => {
            this.pendingTimeout = undefined
            this.flush()
          }, due)
          return
        }
      } else if (input?.activityStart) {
        this.turnAudioStartedAt = 0
        this.turnAudioMs = 0
      } else if (input?.audio) {
        if (this.turnAudioMs === 0) this.turnAudioStartedAt = Date.now()
        this.turnAudioMs +=
          Buffer.byteLength(input.audio.data, 'base64') / BYTES_PER_MS
      }

      this.pending.shift()
      this.socket.send(JSON.stringify(message))
    }
  }

  private clearPendingTimeout() {
    if (!this.pendingTimeout) return
    clearTimeout(this.pendingTimeout)
    this.pendingTimeout = undefined
  }
}

function parseMessage(text: string): any {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

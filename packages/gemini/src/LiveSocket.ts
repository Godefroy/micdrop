import { EventEmitter } from 'eventemitter3'
import WebSocket from 'ws'

/**
 * A connection to the Gemini Live API, shared by GeminiLive and GeminiSTT
 *
 * @see https://ai.google.dev/gemini-api/docs/live-api
 *
 * It opens the session with the setup its owner builds, holds the messages
 * sent before the session is ready, and reconnects when the connection drops.
 * What a new connection has to know is left to the owner, told by the events.
 */

export interface LiveSocketOptions {
  apiKey: string
  connectionTimeout?: number
  retryDelay?: number
  maxRetry?: number
}

export interface LiveSocketEvents {
  /** The session is set up, right before the messages waiting for it go out */
  Ready: []
  Message: [any]
  /** The connection dropped, a new one is attempted after a delay */
  Reconnecting: [number]
  /** No connection could be restored */
  Failed: []
}

const URL =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent'
const SAMPLE_RATE = 16000 // Rate of the audio sent, the one of the Micdrop client
const BYTES_PER_MS = (SAMPLE_RATE * 2) / 1000
const DEFAULT_CONNECTION_TIMEOUT = 5000
const DEFAULT_RETRY_DELAY = 1000
const DEFAULT_MAX_RETRY = 3

export class LiveSocket extends EventEmitter<LiveSocketEvents> {
  private socket?: WebSocket
  private connected = false
  private destroyed = false
  // Messages waiting for the session, or for the end of a turn to be due
  private pending: any[] = []
  private pendingTimeout?: NodeJS.Timeout
  // Audio of the turn as it went out, see flush()
  private turnAudioStartedAt = 0
  private turnAudioMs = 0
  private reconnectTimeout?: NodeJS.Timeout
  private retryCount = 0

  constructor(
    private readonly options: LiveSocketOptions,
    private readonly buildSetup: () => object,
    private readonly log: (...message: any[]) => void
  ) {
    super()
  }

  /** The session is set up and takes messages right away */
  get isConnected(): boolean {
    return this.connected
  }

  connect() {
    this.initWS().catch((error) => {
      this.log('Connection error:', error)
      this.reconnect()
    })
  }

  /** Sends a message once the session is ready, after the ones before it */
  send(message: any) {
    this.pending.push(message)
    this.flush()
  }

  /** Sends a message ahead of the waiting ones, from a Ready listener */
  sendFirst(message: any) {
    this.socket?.send(JSON.stringify(message))
  }

  /** Drops the messages that have not gone out */
  clearPending() {
    this.pending = []
    this.clearPendingTimeout()
  }

  /** Moves to a new connection, keeping the messages that have not gone out */
  renew() {
    this.log('Renewing the connection')
    this.closeSocket()
    this.connect()
  }

  destroy() {
    this.destroyed = true
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = undefined
    }
    this.closeSocket()
    this.pending = []
    this.removeAllListeners()
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
      const socket = this.socket
      if (!this.connected || socket?.readyState !== WebSocket.OPEN) return
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
      socket.send(JSON.stringify(message))
    }
  }

  private clearPendingTimeout() {
    if (!this.pendingTimeout) return
    clearTimeout(this.pendingTimeout)
    this.pendingTimeout = undefined
  }

  private initWS(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(
        `${URL}?key=${encodeURIComponent(this.options.apiKey)}`
      )
      this.socket = socket

      const timeout = setTimeout(() => {
        this.log('Connection timeout')
        this.closeSocket()
        reject(new Error('WebSocket connection timeout'))
      }, this.options.connectionTimeout ?? DEFAULT_CONNECTION_TIMEOUT)

      socket.on('open', () => {
        this.log('Connection opened')
        socket.send(JSON.stringify(this.buildSetup()))
      })

      socket.on('error', (error) => {
        clearTimeout(timeout)
        this.log('WebSocket error:', error)
        reject(new Error('WebSocket connection error'))
      })

      socket.on('close', (code, reason) => {
        clearTimeout(timeout)
        const wasConnected = this.connected
        this.closeSocket()
        if (this.destroyed) return
        this.log('Connection closed', { code, reason: reason.toString() })
        if (wasConnected) {
          this.reconnect()
        } else {
          reject(new Error(`Connection closed: ${reason.toString()}`))
        }
      })

      socket.on('message', (data) => {
        const message = JSON.parse(data.toString())
        if (message.setupComplete) {
          clearTimeout(timeout)
          this.log('Session ready')
          this.connected = true
          this.retryCount = 0
          this.emit('Ready')
          this.flush()
          resolve()
          return
        }
        this.emit('Message', message)
      })
    })
  }

  private closeSocket() {
    const socket = this.socket
    this.socket = undefined
    this.connected = false
    this.clearPendingTimeout()
    if (!socket) return
    socket.removeAllListeners()
    socket.on('error', () => {})
    if (
      socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING
    ) {
      socket.close(1000)
    }
  }

  private reconnect() {
    if (this.destroyed) return
    this.retryCount++
    if (this.retryCount > (this.options.maxRetry ?? DEFAULT_MAX_RETRY)) {
      this.log('Max retries reached, giving up')
      this.emit('Failed')
      return
    }
    this.emit('Reconnecting', this.retryCount)
    this.log('Reconnecting...')
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = undefined
      this.connect()
    }, this.options.retryDelay ?? DEFAULT_RETRY_DELAY)
  }
}

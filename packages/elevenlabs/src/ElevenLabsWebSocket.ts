import { ReconnectingSocket } from '@micdrop/server'
import type { Readable } from 'stream'
import type { ElevenLabsTTSOptions } from './types'

const DEFAULT_MAX_RETRY = 3

/** One of the two ElevenLabs WebSockets, driven by ElevenLabsTTS */
export interface ElevenLabsWebSocket {
  speak(textStream: Readable): void
  cancel(): void
  destroy(): void
}

/** What a WebSocket hands back to the ElevenLabsTTS driving it */
export interface ElevenLabsWebSocketHost {
  audio(chunk: Buffer): void
  failed(texts: string[]): void
  log(...message: any[]): void
}

export interface ElevenLabsConnectionOptions {
  url: string
  tts: ElevenLabsTTSOptions
  /** First message of every connection, which sets the session up */
  init: object
  keepAlive: { interval: number; message: object }
  host: ElevenLabsWebSocketHost
  /** The connection opened, after a drop when `reconnected` is true */
  onOpen(reconnected: boolean): void
  onMessage(message: any): void
  /** Every retry failed, and the connection waits for `connect()` */
  onFailed(): void
}

/**
 * The connection of one of the two WebSockets, reconnecting on its own.
 *
 * ElevenLabs opens a connection before it checks the key and the voice, then
 * closes it with an error. Such a connection opens fine, which would start the
 * retry count of ReconnectingSocket over each time and reconnect forever. So a
 * connection closed before it proved usable counts as a failed one, and the
 * connection gives up once they exceed `maxRetry` in a row.
 */
export class ElevenLabsConnection {
  private socket: ReconnectingSocket
  // Whether the current connection carried audio or lived long enough for a
  // keep-alive, which means the server accepted the key and the voice
  private proven = false
  private failures = 0

  constructor(private readonly options: ElevenLabsConnectionOptions) {
    this.socket = this.createSocket()
  }

  /** Opens the connection, again after giving up, and does nothing otherwise */
  connect() {
    this.socket.connect()
  }

  /**
   * Resolves to false when the connection gives up or is destroyed meanwhile,
   * and right away once it gave up, until the next `connect()`: the stream
   * that was speaking then has nothing left to wait for.
   */
  ready(): Promise<boolean> {
    if (this.socket.status === 'idle') return Promise.resolve(false)
    return this.socket.ready()
  }

  send(message: object): boolean {
    return this.socket.send(JSON.stringify(message))
  }

  /** Drops the connection, with the synthesis running on it, for a new one */
  restart() {
    this.socket.restart()
  }

  destroy() {
    this.socket.destroy()
  }

  /** The current connection works, so its next drop is not a failure */
  prove() {
    this.proven = true
    this.failures = 0
  }

  private createSocket() {
    const { tts, keepAlive, host } = this.options
    const socket = new ReconnectingSocket({
      url: this.options.url,
      clientOptions: { headers: { 'xi-api-key': tts.apiKey } },
      connectionTimeout: tts.connectionTimeout,
      retryDelay: tts.retryDelay,
      maxRetry: tts.maxRetry,
      handshake: {
        start: (ws) => ws.send(JSON.stringify(this.options.init)),
      },
      keepAlive: {
        interval: keepAlive.interval,
        message: () => {
          this.prove()
          return JSON.stringify(keepAlive.message)
        },
      },
      log: (...message) => host.log(...message),
    })

    socket.on('Open', ({ reconnected }) => {
      this.proven = false
      this.options.onOpen(reconnected)
    })

    socket.on('Message', (data) => {
      try {
        this.options.onMessage(JSON.parse(data.toString()))
      } catch (error: any) {
        host.log('message' in error ? error.message : error)
        host.log('Event data during error:', data.toString())
      }
    })

    socket.on('Close', () => {
      if (this.proven) return
      this.failures++
      if (this.failures > (tts.maxRetry ?? DEFAULT_MAX_RETRY)) this.giveUp()
    })

    socket.on('Failed', () => this.giveUp())
    return socket
  }

  private giveUp() {
    this.options.host.log('Max retries reached, giving up')
    this.failures = 0
    // An idle socket replaces the one that gave up, so the next utterance
    // connects again with a full retry budget
    this.socket.destroy()
    this.socket = this.createSocket()
    this.options.onFailed()
  }
}

import { EventEmitter } from 'eventemitter3'
import WebSocket, { ClientOptions, RawData } from 'ws'

/**
 * Where a {@link ReconnectingSocket} stands.
 *
 * - `idle`: not connected yet, `connect()` has not been called
 * - `connecting`: an attempt is under way, the first one or a retry
 * - `open`: connected, and done with its handshake if it has one
 * - `reconnecting`: the connection dropped, a new attempt waits for its delay
 * - `failed`: every retry failed, `connect()` starts over
 * - `destroyed`: closed for good
 */
export type ReconnectingSocketStatus =
  'idle' | 'connecting' | 'open' | 'reconnecting' | 'failed' | 'destroyed'

export interface ReconnectingSocketOptions {
  /**
   * Address to connect to, or a function giving it for each attempt, for a
   * session URL or a token that has to be fresh.
   */
  url: string | (() => string | Promise<string>)

  /** Options of the `ws` client, headers included */
  clientOptions?: ClientOptions

  /** How long an attempt may take, handshake included, 5000 ms by default */
  connectionTimeout?: number

  /** How long to wait before a new attempt, 1000 ms by default */
  retryDelay?: number

  /** How many attempts in a row may fail before giving up, 3 by default */
  maxRetry?: number

  /**
   * Sets the session up before the connection counts as open, for a protocol
   * that takes nothing else until then. See {@link ReconnectingSocketHandshake}.
   */
  handshake?: ReconnectingSocketHandshake

  /** Sends a message on a regular basis, to keep an idle connection open */
  keepAlive?: {
    /** Interval between two messages, in milliseconds */
    interval: number
    message: string | (() => string)
  }

  /** Receives the log lines, the `log` method of the owner usually */
  log?: (...message: any[]) => void
}

/**
 * What a connection does between the socket opening and the session being
 * ready.
 *
 * Everything runs in the tick of the message it reads, so the connection is
 * open before the next message arrives and none is lost in between.
 */
export interface ReconnectingSocketHandshake {
  /** Sends what opens the session, as soon as the socket opens */
  start?(socket: WebSocket): void
  /**
   * Reads the messages that come before the session is ready, which are not
   * emitted as `Message`, and returns true on the one saying it is. Throwing
   * fails the attempt, for a session the server refused.
   *
   * Without it, the connection opens right after `start`, and proves itself
   * like one without a handshake: by a first message, or by staying open.
   */
  read?(data: RawData, isBinary: boolean): boolean
}

export interface ReconnectingSocketEvents {
  /** The status changed */
  StatusChange: [ReconnectingSocketStatus]
  /**
   * The connection is open. A reconnection is the moment to send again what
   * the previous connection did not finish.
   */
  Open: [{ reconnected: boolean }]
  Message: [RawData, boolean]
  /** The connection dropped, `reconnecting` or `failed` follows */
  Close: [number, string]
  /** Every retry failed */
  Failed: [Error]
}

const DEFAULT_CONNECTION_TIMEOUT = 5000
const DEFAULT_RETRY_DELAY = 1000
const DEFAULT_MAX_RETRY = 3

/**
 * A WebSocket to a provider that reconnects on its own.
 *
 * Every connection a provider holds goes through the same states, and they
 * live here, in one place: one attempt at a time, a failure counted once
 * whatever the socket reports about it, a retry budget, and a `ready()` that
 * settles whatever happens. A socket left behind by a reconnection is silenced,
 * so it never acts on the one that replaced it.
 *
 * The owner keeps what belongs to its protocol: what to send again on
 * `Open`, and what the messages mean.
 */
export class ReconnectingSocket extends EventEmitter<ReconnectingSocketEvents> {
  private _status: ReconnectingSocketStatus = 'idle'
  private socket?: WebSocket
  private everOpened = false
  private retryCount = 0
  // Running from the open until the connection proves itself
  private proofTimer?: ReturnType<typeof setTimeout>
  // Numbers the attempts, so one overtaken while it awaited its address stops
  private attemptId = 0
  private retryTimer?: ReturnType<typeof setTimeout>
  private keepAliveTimer?: ReturnType<typeof setInterval>
  private waiters: Array<(open: boolean) => void> = []

  constructor(private readonly options: ReconnectingSocketOptions) {
    super()
  }

  get status(): ReconnectingSocketStatus {
    return this._status
  }

  /** Whether a message sent now goes out */
  get isOpen(): boolean {
    return this._status === 'open'
  }

  /**
   * Opens the connection. Called again after `failed`, it starts over with a
   * full retry budget, and does nothing in any other status.
   */
  connect() {
    if (this._status !== 'idle' && this._status !== 'failed') return
    this.retryCount = 0
    this.attempt()
  }

  /**
   * Waits for the connection to be open.
   * @returns True once open, false if it failed or was destroyed meanwhile
   */
  ready(): Promise<boolean> {
    if (this._status === 'open') return Promise.resolve(true)
    if (this._status === 'destroyed' || this._status === 'failed') {
      return Promise.resolve(false)
    }
    return new Promise((resolve) => this.waiters.push(resolve))
  }

  /**
   * Sends a message if the connection is open
   * @returns False when it did not go out
   */
  send(data: string | Buffer): boolean {
    if (this._status !== 'open' || !this.socket) return false
    this.socket.send(data)
    return true
  }

  /**
   * Drops the connection and opens a new one right away, for a provider that
   * can only stop what it is doing by closing. It costs no retry, and the new
   * connection is not a reconnection.
   */
  restart() {
    if (this._status === 'destroyed') return
    this.log('Restarting the connection')
    this.clearRetryTimer()
    this.drop()
    this.everOpened = false
    this.retryCount = 0
    this.attempt()
  }

  /** Closes the connection for good */
  destroy() {
    if (this._status === 'destroyed') return
    this.clearRetryTimer()
    this.drop()
    this.setStatus('destroyed')
    this.settleWaiters(false)
    this.removeAllListeners()
  }

  private async attempt() {
    const id = ++this.attemptId
    // Restarted or destroyed while the address was on its way
    const isOvertaken = () =>
      id !== this.attemptId || this._status !== 'connecting'
    this.setStatus('connecting')
    let url: string
    try {
      const { url: getUrl } = this.options
      url = typeof getUrl === 'string' ? getUrl : await getUrl()
    } catch (error) {
      if (isOvertaken()) return
      this.onAttemptFailed(error as Error)
      return
    }
    if (isOvertaken()) return

    const socket = new WebSocket(url, this.options.clientOptions)
    this.socket = socket
    let settled = false

    // The first word on a failed attempt is the only one that counts: a socket
    // that fails reports an error, then its close
    const fail = (error: Error) => {
      if (settled || this.socket !== socket) return
      settled = true
      clearTimeout(timeout)
      this.drop()
      this.onAttemptFailed(error)
    }

    const timeout = setTimeout(
      () => fail(new Error('Connection timeout')),
      this.options.connectionTimeout ?? DEFAULT_CONNECTION_TIMEOUT
    )

    socket.on('error', (error) => {
      this.log('WebSocket error:', error.message)
      fail(error)
    })

    const { handshake } = this.options
    const open = () => {
      settled = true
      clearTimeout(timeout)
      this.onOpen()
    }

    socket.on('open', () => {
      if (this.socket !== socket) return
      try {
        handshake?.start?.(socket)
      } catch (error) {
        fail(error as Error)
        return
      }
      if (!handshake?.read) open()
    })

    socket.on('message', (data, isBinary) => {
      if (this.socket !== socket) return
      if (this._status === 'open') {
        this.prove()
        this.emit('Message', data, isBinary)
        return
      }
      // Still in the handshake, which reads every message until it is done
      if (settled || !handshake?.read) return
      try {
        if (handshake.read(data, isBinary)) open()
      } catch (error) {
        fail(error as Error)
      }
    })

    socket.on('close', (code, reasonBuffer) => {
      const reason = reasonBuffer.toString()
      if (!settled) {
        fail(new Error(`Connection closed (${code}) ${reason}`))
        return
      }
      if (this.socket !== socket) return
      // Whatever the code, the server closed a connection the owner still
      // wants, so it is opened again: a graceful close too
      this.log('Connection closed', { code, reason })
      this.drop()
      // Out of `open` before anyone hears of it, so a Close listener that
      // waits on ready() waits for the next connection
      this.setStatus('reconnecting')
      this.emit('Close', code, reason)
      // A listener may have restarted or destroyed the socket meanwhile
      if (this._status !== 'reconnecting') return
      this.scheduleRetry(new Error(`Connection closed (${code}) ${reason}`))
    })
  }

  private onOpen() {
    this.log('Connection opened')
    const reconnected = this.everOpened
    this.everOpened = true
    // A server can accept the connection and close it right away, a refused
    // key or voice for instance. Such a connection still counts as a failed
    // attempt, so the retry budget runs out instead of looping for good. It
    // proves itself with a handshake the server answered, a first message, or
    // by staying open.
    if (this.options.handshake?.read) {
      this.prove()
    } else {
      this.proofTimer = setTimeout(
        () => this.prove(),
        this.options.connectionTimeout ?? DEFAULT_CONNECTION_TIMEOUT
      )
    }
    this.startKeepAlive()
    this.setStatus('open')
    this.emit('Open', { reconnected })
    this.settleWaiters(true)
  }

  /** The connection works, the retry budget is whole again */
  private prove() {
    this.clearProofTimer()
    this.retryCount = 0
  }

  private clearProofTimer() {
    if (!this.proofTimer) return
    clearTimeout(this.proofTimer)
    this.proofTimer = undefined
  }

  private onAttemptFailed(error: Error) {
    this.log('Connection failed:', error.message)
    this.scheduleRetry(error)
  }

  private scheduleRetry(error: Error) {
    if (this._status === 'destroyed') return
    this.retryCount++
    if (this.retryCount > (this.options.maxRetry ?? DEFAULT_MAX_RETRY)) {
      this.log('Max retries reached, giving up')
      this.setStatus('failed')
      this.settleWaiters(false)
      this.emit('Failed', error)
      return
    }
    this.setStatus('reconnecting')
    this.log(`Reconnecting (attempt ${this.retryCount})`)
    this.clearRetryTimer()
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined
      if (this._status === 'reconnecting') this.attempt()
    }, this.options.retryDelay ?? DEFAULT_RETRY_DELAY)
  }

  /** Lets go of the current socket, which will never be heard from again */
  private drop() {
    this.stopKeepAlive()
    this.clearProofTimer()
    const socket = this.socket
    this.socket = undefined
    if (!socket) return
    socket.removeAllListeners()
    // A socket closed while connecting reports an error, and an error nobody
    // listens to crashes the process
    socket.on('error', () => {})
    if (
      socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING
    ) {
      socket.close(1000)
    }
  }

  private startKeepAlive() {
    const keepAlive = this.options.keepAlive
    if (!keepAlive) return
    this.stopKeepAlive()
    this.keepAliveTimer = setInterval(() => {
      const { message } = keepAlive
      this.send(typeof message === 'string' ? message : message())
    }, keepAlive.interval)
  }

  private stopKeepAlive() {
    if (!this.keepAliveTimer) return
    clearInterval(this.keepAliveTimer)
    this.keepAliveTimer = undefined
  }

  private clearRetryTimer() {
    if (!this.retryTimer) return
    clearTimeout(this.retryTimer)
    this.retryTimer = undefined
  }

  private settleWaiters(open: boolean) {
    const waiters = this.waiters
    this.waiters = []
    waiters.forEach((resolve) => resolve(open))
  }

  private setStatus(status: ReconnectingSocketStatus) {
    if (this._status === status) return
    this._status = status
    this.emit('StatusChange', status)
  }

  private log(...message: any[]) {
    this.options.log?.(...message)
  }
}

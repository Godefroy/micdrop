import { ReconnectingSocketHandshake } from '@micdrop/server'
import WebSocket from 'ws'

/**
 * Waits for the first event of a Realtime session, as the handshake of a
 * ReconnectingSocket.
 *
 * The API opens the WebSocket before it checks the session, and announces it
 * with `session.created` once it accepts it. Until then an open socket says
 * nothing about the key or the model, so the connection only counts as open
 * from there, and its retry budget starts over only then. An `error` event
 * before it fails the attempt, and so does a close.
 */
export const sessionHandshake: ReconnectingSocketHandshake = {
  read(data) {
    const message = parseMessage(data)
    if (message?.type === 'error') {
      throw new Error(message.error?.message || 'Session refused')
    }
    return (
      message?.type === 'session.created' ||
      message?.type === 'transcription_session.created'
    )
  },
}

/** Reads a message of the Realtime API, or undefined if it is not JSON */
export function parseMessage(data: WebSocket.RawData): any {
  try {
    return JSON.parse(data.toString())
  } catch {
    return undefined
  }
}

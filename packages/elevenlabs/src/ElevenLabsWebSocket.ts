import type { Readable } from 'stream'
import WebSocket from 'ws'

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

/**
 * Closes a socket without hearing from it again.
 *
 * A socket closed while still connecting emits an error, and an error nobody
 * listens to crashes the process, so a listener that ignores it stays.
 */
export function closeSocket(socket: WebSocket) {
  socket.removeAllListeners()
  socket.on('error', () => {})
  if (
    socket.readyState === WebSocket.OPEN ||
    socket.readyState === WebSocket.CONNECTING
  ) {
    socket.close(1000)
  }
}

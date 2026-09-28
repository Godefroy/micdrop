import WebSocket from 'ws'

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

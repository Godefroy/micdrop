import assert from 'node:assert/strict'
import { AddressInfo } from 'node:net'
import { afterEach, describe, it } from 'node:test'
import { WebSocketServer } from 'ws'
import {
  ReconnectingSocket,
  ReconnectingSocketOptions,
  ReconnectingSocketStatus,
} from '../src/index'

const sockets: ReconnectingSocket[] = []
const servers: WebSocketServer[] = []

afterEach(async () => {
  sockets.splice(0).forEach((socket) => socket.destroy())
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.clients.forEach((client) => client.terminate())
          server.close(() => resolve())
        })
    )
  )
})

async function startServer(): Promise<{
  server: WebSocketServer
  url: string
}> {
  const server = new WebSocketServer({ port: 0 })
  servers.push(server)
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const { port } = server.address() as AddressInfo
  return { server, url: `ws://127.0.0.1:${port}` }
}

/** An address nothing listens on, which refuses every connection */
async function deadUrl(): Promise<string> {
  const { server, url } = await startServer()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  servers.splice(servers.indexOf(server), 1)
  return url
}

function createSocket(options: ReconnectingSocketOptions) {
  const socket = new ReconnectingSocket({
    retryDelay: 10,
    connectionTimeout: 500,
    ...options,
  })
  sockets.push(socket)
  return socket
}

function recordStatuses(socket: ReconnectingSocket) {
  const statuses: ReconnectingSocketStatus[] = []
  socket.on('StatusChange', (status) => statuses.push(status))
  return statuses
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('ReconnectingSocket', () => {
  it('opens, sends and receives', async () => {
    const { server, url } = await startServer()
    server.on('connection', (client) =>
      client.on('message', (data) => client.send(`echo ${data}`))
    )
    const socket = createSocket({ url })
    const opens: boolean[] = []
    socket.on('Open', ({ reconnected }) => opens.push(reconnected))
    const message = new Promise<string>((resolve) =>
      socket.on('Message', (data) => resolve(data.toString()))
    )

    assert.equal(socket.send('lost'), false)
    socket.connect()
    assert.equal(await socket.ready(), true)
    assert.equal(socket.send('hello'), true)
    assert.equal(await message, 'echo hello')
    assert.deepEqual(opens, [false])
  })

  it('counts a refused attempt once, error and close together', async () => {
    const url = await deadUrl()
    const socket = createSocket({ url, maxRetry: 2 })
    const statuses = recordStatuses(socket)
    const failed = new Promise<void>((resolve) =>
      socket.once('Failed', () => resolve())
    )

    socket.connect()
    await failed
    // One retry per allowed failure, not two
    assert.deepEqual(statuses, [
      'connecting',
      'reconnecting',
      'connecting',
      'reconnecting',
      'connecting',
      'failed',
    ])
  })

  it('settles ready() with false when it gives up', async () => {
    const socket = createSocket({ url: await deadUrl(), maxRetry: 1 })
    socket.connect()
    assert.equal(await socket.ready(), false)
    assert.equal(socket.status, 'failed')
    assert.equal(await socket.ready(), false)
  })

  it('starts over with a full budget when connected again after failing', async () => {
    const socket = createSocket({ url: await deadUrl(), maxRetry: 0 })
    socket.connect()
    assert.equal(await socket.ready(), false)

    const { url } = await startServer()
    ;(socket as any).options.url = url
    socket.connect()
    assert.equal(await socket.ready(), true)
  })

  it('reconnects after a graceful close from the server', async () => {
    const { server, url } = await startServer()
    let connections = 0
    server.on('connection', (client) => {
      connections++
      if (connections === 1) client.close(1000, 'bye')
    })
    const socket = createSocket({ url })
    const opens: boolean[] = []
    const reopened = new Promise<void>((resolve) =>
      socket.on('Open', ({ reconnected }) => {
        opens.push(reconnected)
        if (reconnected) resolve()
      })
    )

    socket.connect()
    await reopened
    assert.deepEqual(opens, [false, true])
    assert.equal(socket.status, 'open')
  })

  it('never opens again once destroyed, even with a retry pending', async () => {
    const socket = createSocket({ url: await deadUrl(), retryDelay: 30 })
    const statuses = recordStatuses(socket)
    socket.connect()
    const ready = socket.ready()
    await wait(15)
    socket.destroy()
    assert.equal(await ready, false)

    const { server } = await startServer()
    let connected = false
    server.on('connection', () => (connected = true))
    await wait(80)
    assert.equal(connected, false)
    assert.equal(statuses.at(-1), 'destroyed')
  })

  it('restarts on a new connection, silencing the old one', async () => {
    const { server, url } = await startServer()
    const clients: any[] = []
    server.on('connection', (client) => clients.push(client))
    const socket = createSocket({ url })
    const messages: string[] = []
    socket.on('Message', (data) => messages.push(data.toString()))
    const opens: boolean[] = []
    socket.on('Open', ({ reconnected }) => opens.push(reconnected))

    socket.connect()
    await socket.ready()
    socket.restart()
    assert.equal(socket.status, 'connecting')
    await socket.ready()
    await wait(20)

    clients[0].send('stale')
    clients[1].send('fresh')
    await wait(20)
    assert.deepEqual(messages, ['fresh'])
    assert.deepEqual(opens, [false, false])
  })

  it('reads a new address for each attempt, ignoring an overtaken one', async () => {
    const { url } = await startServer()
    let calls = 0
    const socket = createSocket({
      url: async () => {
        calls++
        await wait(calls === 1 ? 40 : 5)
        return url
      },
    })
    const opens: boolean[] = []
    socket.on('Open', ({ reconnected }) => opens.push(reconnected))

    socket.connect()
    socket.restart()
    await socket.ready()
    await wait(60)
    assert.equal(calls, 2)
    assert.deepEqual(opens, [false])
  })

  it('holds the connection until the handshake is done', async () => {
    const { server, url } = await startServer()
    server.on('connection', (client) =>
      client.on('message', (data) => {
        if (data.toString() === 'setup') client.send('ready')
        else client.send(`echo ${data}`)
      })
    )
    const socket = createSocket({
      url,
      handshake: {
        start: (ws) => ws.send('setup'),
        read: (data) => data.toString() === 'ready',
      },
    })
    const messages: string[] = []
    socket.on('Message', (data) => messages.push(data.toString()))

    socket.connect()
    await socket.ready()
    socket.send('hi')
    await wait(20)
    // The handshake reply is the handshake's own
    assert.deepEqual(messages, ['echo hi'])
  })

  it('fails an attempt whose handshake never ends', async () => {
    const { url } = await startServer()
    const socket = createSocket({
      url,
      maxRetry: 0,
      connectionTimeout: 30,
      handshake: { read: () => false },
    })
    socket.connect()
    assert.equal(await socket.ready(), false)
  })

  it('emits the message that follows the handshake in the same packet', async () => {
    const { server, url } = await startServer()
    server.on('connection', (client) =>
      client.on('message', () => {
        // Both leave in one go, and may be read in the same tick
        client.send('ready')
        client.send('first')
      })
    )
    const socket = createSocket({
      url,
      handshake: {
        start: (ws) => ws.send('setup'),
        read: (data) => data.toString() === 'ready',
      },
    })
    const messages: string[] = []
    socket.on('Message', (data) => messages.push(data.toString()))

    socket.connect()
    await socket.ready()
    await wait(20)
    assert.deepEqual(messages, ['first'])
  })

  it('fails an attempt whose handshake is refused', async () => {
    const { server, url } = await startServer()
    server.on('connection', (client) => client.send('refused'))
    const socket = createSocket({
      url,
      maxRetry: 0,
      handshake: {
        read: () => {
          throw new Error('Session refused')
        },
      },
    })
    const errors: string[] = []
    socket.on('Failed', (error) => errors.push(error.message))
    socket.connect()
    assert.equal(await socket.ready(), false)
    assert.deepEqual(errors, ['Session refused'])
  })

  it('keeps an open connection alive', async () => {
    const { server, url } = await startServer()
    const received: string[] = []
    server.on('connection', (client) =>
      client.on('message', (data) => received.push(data.toString()))
    )
    const socket = createSocket({
      url,
      keepAlive: { interval: 10, message: 'ping' },
    })
    socket.connect()
    await socket.ready()
    await wait(45)
    assert.ok(received.length >= 2)
    assert.ok(received.every((message) => message === 'ping'))
  })

  it('has a Close listener wait for the next connection', async () => {
    const { server, url } = await startServer()
    let connections = 0
    server.on('connection', (client) => {
      connections++
      if (connections === 1) client.close(1000, 'bye')
    })
    const socket = createSocket({ url })
    const seen = new Promise<{ status: string; open: boolean; sent: boolean }>(
      (resolve) =>
        socket.once('Close', async () => {
          const status = socket.status
          const open = await socket.ready()
          resolve({ status, open, sent: socket.send('again') })
        })
    )

    socket.connect()
    assert.deepEqual(await seen, {
      status: 'reconnecting',
      open: true,
      sent: true,
    })
  })

  it('lets a Close listener restart the connection', async () => {
    const { server, url } = await startServer()
    let connections = 0
    server.on('connection', (client) => {
      connections++
      if (connections === 1) client.close(1000, 'bye')
    })
    const socket = createSocket({ url, retryDelay: 200 })
    socket.once('Close', () => socket.restart())

    socket.connect()
    await wait(80)
    // Opened again right away, without waiting for the retry delay
    assert.equal(socket.status, 'open')
    assert.equal(connections, 2)
  })

  it('gives up on a server that accepts and closes every connection', async () => {
    const { server, url } = await startServer()
    server.on('connection', (client) => client.close(1008, 'Unknown voice'))
    const socket = createSocket({ url, maxRetry: 2 })
    const failed = new Promise<void>((resolve) =>
      socket.once('Failed', () => resolve())
    )
    socket.connect()
    await failed
    assert.equal(socket.status, 'failed')
  })

  it('keeps a whole budget for a connection that spoke before closing', async () => {
    const { server, url } = await startServer()
    let connections = 0
    server.on('connection', (client) => {
      connections++
      client.send('hello')
      if (connections <= 3) setTimeout(() => client.close(1000), 5)
    })
    const socket = createSocket({ url, maxRetry: 1 })
    socket.connect()
    await wait(150)
    // Three drops in a row, each after a working connection
    assert.equal(connections, 4)
    assert.equal(socket.status, 'open')
  })
})

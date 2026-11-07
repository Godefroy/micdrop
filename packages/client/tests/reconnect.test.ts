import assert from 'node:assert/strict'
import { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'
import { WebSocket, WebSocketServer } from 'ws'
import { Mic, Speaker } from '../src/audio'
import { MicdropClient, MicdropClientErrorCode } from '../src/client'
import { FakeMicDriver, FakeSpeakerDriver } from './fakes'

async function waitFor(
  check: () => boolean,
  message: string,
  timeout = 3000
): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeout) {
      throw new Error(`Timed out waiting for ${message}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('when the connection goes wrong', () => {
  let wss: WebSocketServer
  let url: string
  let sockets: WebSocket[] = []
  let onConnection: (socket: WebSocket) => void = () => {}

  before(async () => {
    wss = new WebSocketServer({ port: 0 })
    await new Promise((resolve) => wss.once('listening', resolve))
    url = `ws://localhost:${(wss.address() as AddressInfo).port}`
    wss.on('connection', (socket) => {
      sockets.push(socket)
      onConnection(socket)
    })
    Mic.setDriver(new FakeMicDriver())
    Speaker.setDriver(new FakeSpeakerDriver())
  })

  after(() => wss.close())

  it('comes back after the server drops the call', async () => {
    sockets = []
    onConnection = () => {}
    const client = new MicdropClient()
    await client.start({ url, reconnect: { delayMs: 20 } })
    await waitFor(() => client.isStarted, 'the call to start')

    // The server crashes
    sockets[0].close(1011, 'Something broke')

    await waitFor(() => sockets.length === 2, 'the client to come back')
    await waitFor(() => client.isStarted, 'the call to resume')
    assert.equal(client.isReconnecting, false)
    await client.stop()
  })

  it('reports an unauthorized call and gives up', async () => {
    sockets = []
    onConnection = (socket) => socket.close(4401, 'Bad token')
    const client = new MicdropClient()
    const errors: MicdropClientErrorCode[] = []
    client.on('Error', (error) => errors.push(error.code))

    await client.start({ url, reconnect: { delayMs: 20 } })
    await waitFor(() => errors.length > 0, 'the error to be reported')

    assert.deepEqual(errors, [MicdropClientErrorCode.Unauthorized])
    assert.equal(client.error?.message, 'Bad token')

    // No point retrying with the same token
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(sockets.length, 1)
    assert.equal(client.isStarted, false)
    await client.stop()
  })

  it('walks through each status of the call', async () => {
    sockets = []
    onConnection = () => {}
    const client = new MicdropClient()
    const statuses: string[] = []
    client.on('StateChange', (state) => {
      if (statuses.at(-1) !== state.status) statuses.push(state.status)
    })

    assert.equal(client.status, 'stopped')
    await client.start({ url, reconnect: { delayMs: 20 } })
    await waitFor(() => client.status === 'started', 'the call to start')
    sockets[0].close(1011, 'Something broke')
    await waitFor(() => sockets.length === 2, 'the client to come back')
    await waitFor(() => client.status === 'started', 'the call to resume')
    await client.stop()

    assert.deepEqual(statuses, [
      'starting',
      'started',
      'reconnecting',
      'started',
      'stopped',
    ])
  })

  it('stays on a call started again right after a stop', async () => {
    sockets = []
    onConnection = () => {}
    const client = new MicdropClient()
    await client.start({ url })
    await waitFor(() => client.isStarted, 'the first call to start')

    // The first socket reports its close once the second call is under way
    await client.stop()
    await client.start({ url })
    await waitFor(() => client.isStarted, 'the second call to start')
    await new Promise((resolve) => setTimeout(resolve, 100))

    assert.equal(client.status, 'started')
    assert.equal(sockets.length, 2)
    await client.stop()
  })

  it('never reconnects once stopped', async () => {
    sockets = []
    onConnection = () => {}
    const client = new MicdropClient()
    await client.start({ url, reconnect: { delayMs: 50 } })
    await waitFor(() => client.isStarted, 'the call to start')

    sockets[0].close(1011, 'Something broke')
    await waitFor(() => client.isReconnecting, 'the client to notice')
    await client.stop()
    await new Promise((resolve) => setTimeout(resolve, 150))

    assert.equal(sockets.length, 1)
    assert.equal(client.status, 'stopped')
  })

  it('refuses to start without a server address', async () => {
    const client = new MicdropClient()
    await assert.rejects(() => client.start({}))
    assert.equal(client.error?.code, MicdropClientErrorCode.MissingUrl)
  })

  it('reports a microphone that will not start', async () => {
    const mic = new FakeMicDriver()
    mic.start = async () => {
      throw new Error('Microphone permission denied')
    }
    Mic.setDriver(mic)

    const client = new MicdropClient()
    await assert.rejects(() => client.start({ url }))
    assert.equal(client.error?.code, MicdropClientErrorCode.Mic)
    assert.equal(client.error?.message, 'Microphone permission denied')

    Mic.setDriver(new FakeMicDriver())
  })
})

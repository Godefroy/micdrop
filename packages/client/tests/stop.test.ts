import assert from 'node:assert/strict'
import { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'
import { WebSocket, WebSocketServer } from 'ws'
import { Mic, Speaker } from '../src/audio'
import { MicdropClient } from '../src/client'
import { MicdropServerCommands } from '../src/types'
import { FakeMicDriver, FakeSpeakerDriver } from './fakes'

async function waitFor(check: () => boolean, message: string, timeout = 3000) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeout) {
      throw new Error(`Timed out waiting for ${message}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('stopping once the answer is over', () => {
  let wss: WebSocketServer
  let url: string
  let sockets: WebSocket[] = []

  before(async () => {
    wss = new WebSocketServer({ port: 0 })
    await new Promise((resolve) => wss.once('listening', resolve))
    url = `ws://localhost:${(wss.address() as AddressInfo).port}`
    wss.on('connection', (socket) => sockets.push(socket))
    Mic.setDriver(new FakeMicDriver())
    Speaker.setDriver(new FakeSpeakerDriver())
  })

  after(() => wss.close())

  async function startCall() {
    sockets = []
    const client = new MicdropClient()
    await client.start({ url })
    await waitFor(() => client.isStarted, 'the call to start')
    return client
  }

  it('waits for the answer being prepared, then stops', async () => {
    const client = await startCall()
    // A call starts waiting for the first message
    assert.equal(client.activity, 'processing')

    const stopped = client.stopAfterAnswer()
    await wait(50)
    assert.equal(client.status, 'started', 'the answer is still awaited')

    sockets[0].send(MicdropServerCommands.SkipAnswer)
    await stopped
    assert.equal(client.status, 'stopped')
  })

  it('stops right away when no answer is under way', async () => {
    const client = await startCall()
    sockets[0].send(MicdropServerCommands.SkipAnswer)
    await waitFor(() => client.activity === 'listening', 'the call to listen')

    await client.stopAfterAnswer()
    assert.equal(client.status, 'stopped')
  })

  it('leaves the next call alone once started again', async () => {
    const client = await startCall()
    // Waits for the answer, then the user stops and starts again
    client.stopAfterAnswer()
    await client.stop()
    await client.start({ url })
    await waitFor(() => client.isStarted, 'the next call to start')

    // The answer of the new call ends, which the old wait would act on
    sockets[sockets.length - 1].send(MicdropServerCommands.SkipAnswer)
    await waitFor(
      () => client.activity === 'listening',
      'the next call to listen'
    )
    await wait(50)

    assert.equal(client.status, 'started')
    await client.stop()
  })
})

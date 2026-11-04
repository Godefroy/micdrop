import assert from 'node:assert/strict'
import { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { WebSocketServer } from 'ws'
import { Mic, Speaker } from '../src/audio'
import { MicdropClient } from '../src/client'
import { MicdropClientCommands } from '../src/types'
import { FakeMicDriver, FakeSpeakerDriver, ManualVAD } from './fakes'

class RoutingSpeaker extends FakeSpeakerDriver {
  public moves = 0
  public resets = 0
  async useEchoFallback() {
    this.moves++
    return true
  }
  resetEchoFallback() {
    this.resets++
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

describe('a client hearing the assistant through the microphone', () => {
  let wss: WebSocketServer
  let client: MicdropClient
  let vad: ManualVAD
  let messages: string[]

  async function startCall(speaker: FakeSpeakerDriver) {
    Mic.setDriver(new FakeMicDriver())
    Speaker.setDriver(speaker)
    vad = new ManualVAD()
    client = new MicdropClient()
    await client.start({
      url: `ws://localhost:${(wss.address() as AddressInfo).port}`,
      vad,
    })
    while (!client.isStarted) await tick()
  }

  function hearSpeech() {
    vad.emit('StartSpeaking')
    vad.emit('ConfirmSpeaking')
  }

  beforeEach(async () => {
    messages = []
    wss = new WebSocketServer({ port: 0 })
    await new Promise((resolve) => wss.once('listening', resolve))
    wss.on('connection', (socket) => {
      socket.on('message', (data) => messages.push(data.toString()))
    })
  })

  afterEach(async () => {
    await client.stop()
    // Its socket closes later, and stops whichever speaker is current by then
    await new Promise((resolve) => setTimeout(resolve, 30))
    wss.close()
  })

  it('keeps playing and moves to the other route on a first echo', async () => {
    const speaker = new RoutingSpeaker()
    await startCall(speaker)
    speaker.setPlaying(true)

    hearSpeech()
    await tick()

    assert.equal(speaker.stopAudioCalls, 0)
    assert.equal(speaker.moves, 1)
    assert.equal(client.echoStage, 'fallback')
    assert.equal(client.isUserSpeaking, false)
    assert.equal(client.isInterruptionDisabled, false)
    assert.equal(messages.includes(MicdropClientCommands.StartSpeaking), false)
    assert.equal(vad.isPaused, false)
  })

  it('gives up on interruptions on a second echo', async () => {
    const speaker = new RoutingSpeaker()
    await startCall(speaker)
    speaker.setPlaying(true)

    hearSpeech()
    await tick()
    hearSpeech()
    await tick()

    assert.equal(speaker.stopAudioCalls, 0)
    assert.equal(client.echoStage, 'disabled')
    assert.equal(client.isInterruptionDisabled, true)
    assert.equal(vad.isPaused, true)
    assert.equal(messages.includes(MicdropClientCommands.StartSpeaking), false)
  })

  it('gives up straight away on a platform with one route', async () => {
    const speaker = new FakeSpeakerDriver()
    await startCall(speaker)
    speaker.setPlaying(true)

    hearSpeech()
    await tick()

    assert.equal(speaker.stopAudioCalls, 0)
    assert.equal(client.echoStage, 'disabled')
    assert.equal(vad.isPaused, true)
  })

  it('lets an interruption through outside the watch', async () => {
    const speaker = new RoutingSpeaker()
    await startCall(speaker)
    speaker.setPlaying(true)
    speaker.setPlaying(false)
    speaker.setPlaying(true)

    hearSpeech()
    await tick()

    assert.equal(speaker.stopAudioCalls, 1)
    assert.equal(client.echoStage, 'normal')
    assert.equal(messages.includes(MicdropClientCommands.StartSpeaking), true)
  })

  it('forgets everything with the call', async () => {
    const speaker = new RoutingSpeaker()
    await startCall(speaker)
    speaker.setPlaying(true)
    hearSpeech()
    await tick()

    await client.stop()

    assert.equal(client.echoStage, 'normal')
    assert.ok(speaker.resets > 0)
  })
})

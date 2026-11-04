import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { Readable } from 'node:stream'
import { AddressInfo } from 'node:net'
import { WebSocketServer } from 'ws'
import { MicdropServer, SentenceTTS, STT } from '@micdrop/server'
import { MockAgent } from '@micdrop/server'
import { Mic, Speaker } from '../src/audio'
import { floatToPcm16, pcm16ToFloat } from '../src/audio/pcm'
import { MicdropClient } from '../src/client'
import {
  FakeMicDriver,
  FakeSpeakerDriver,
  FakeTurnDetector,
  silence,
  sine,
} from './fakes'

/**
 * A speech to text that reports how much audio it was given, so a test can
 * tell that the microphone reached the server.
 */
class CountingSTT extends STT {
  public bytes = 0
  public streams = 0

  transcribe(audioStream: Readable) {
    this.streams++
    let bytes = 0
    audioStream.on('data', (chunk: Buffer) => {
      bytes += chunk.byteLength
    })
    audioStream.on('end', () => {
      this.bytes = bytes
      this.emit('Transcript', `${bytes} bytes of speech`)
    })
  }
}

/** A text to speech that answers with a tone, one 100 ms chunk at a time */
class ToneTTS extends SentenceTTS {
  protected async synthesize(text: string) {
    const chunks = 4
    const buffers: Buffer[] = []
    for (let i = 0; i < chunks; i++) {
      const samples = sine(0.1, { amplitude: 0.5, frequency: 440 })
      buffers.push(Buffer.from(floatToPcm16(samples).buffer))
    }
    return Buffer.concat(buffers)
  }
}

/** Waits for a condition, so a test does not depend on fixed delays */
async function waitFor(
  check: () => boolean,
  message: string,
  timeout = 5000
): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeout) {
      throw new Error(`Timed out waiting for ${message}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('a whole call, from the microphone to the speaker', () => {
  let wss: WebSocketServer
  let url: string
  let mic: FakeMicDriver
  let speaker: FakeSpeakerDriver
  let client: MicdropClient
  let stt: CountingSTT
  let server: MicdropServer | undefined
  let receivedParams: any
  let playedBeforeAnswer = 0

  before(async () => {
    stt = new CountingSTT()
    wss = new WebSocketServer({ port: 0 })
    await new Promise((resolve) => wss.once('listening', resolve))
    url = `ws://localhost:${(wss.address() as AddressInfo).port}`

    wss.on('connection', (socket) => {
      socket.once('message', (message) => {
        try {
          receivedParams = JSON.parse(message.toString())
        } catch {
          // Not the params, the call starts without them
        }
      })
      server = new MicdropServer(socket, {
        firstMessage: 'Hello there',
        agent: new MockAgent(),
        stt,
        tts: new ToneTTS(),
      })
    })

    mic = new FakeMicDriver()
    speaker = new FakeSpeakerDriver()
    Mic.setDriver(mic)
    Speaker.setDriver(speaker)
    client = new MicdropClient()
  })

  after(async () => {
    await client.stop()
    wss.close()
  })

  /** Pushes `seconds` of audio through the fake microphone, in 10 ms frames */
  async function speak(seconds: number, loud: boolean) {
    const frames = Math.round(seconds * 100)
    for (let i = 0; i < frames; i++) {
      mic.push(loud ? sine(0.01, { amplitude: 0.4 }) : silence(0.01), 16000)
      // Let the event loop breathe, the client answers asynchronously
      if (i % 10 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  it('starts the microphone, the speaker and the connection', async () => {
    await client.start({ url, params: { token: 'test-token' } })

    await waitFor(() => client.isStarted, 'the call to start')
    assert.equal(mic.isStarted, true)
    assert.equal(client.isMicStarted, true)
    assert.equal(client.error, undefined)
  })

  it('sends the parameters the app passed', async () => {
    await waitFor(() => !!receivedParams, 'the params to reach the server')
    assert.deepEqual(receivedParams, { token: 'test-token' })
  })

  it('lists the devices the system offers', () => {
    assert.deepEqual(client.micDevices, mic.devices)
    assert.deepEqual(client.speakerDevices, speaker.devices)
  })

  it('plays the first message the assistant says', async () => {
    await waitFor(() => speaker.played.length > 0, 'the first message audio')
    await waitFor(
      () => client.conversation.length > 0,
      'the first message text'
    )

    assert.deepEqual(client.conversation[0], {
      role: 'assistant',
      content: 'Hello there',
    })

    // What came out of the speaker is the tone the server synthesized
    const played = pcm16ToFloat(speaker.allSamples)
    assert.ok(played.length > 0)
    assert.ok(
      Math.max(...played) > 0.4,
      'the audio arrived at full amplitude, so no byte was lost on the way'
    )
  })

  it('stops the assistant as soon as the user speaks', async () => {
    // A voice right as the first message starts would be taken for its echo
    speaker.setPlaying(false)
    speaker.setPlaying(true)
    const stopCalls = speaker.stopAudioCalls
    await speak(0.5, true)

    await waitFor(() => client.isUserSpeaking, 'the VAD to hear the user')
    assert.ok(
      speaker.stopAudioCalls > stopCalls,
      'the assistant was interrupted'
    )
  })

  it('sends what the user said to the server', async () => {
    playedBeforeAnswer = speaker.played.length
    await speak(1, true)
    await speak(1, false)

    await waitFor(() => stt.bytes > 0, 'the speech to reach the server')
    // A second of speech is ten chunks of 1600 samples of 2 bytes
    assert.ok(
      stt.bytes >= 3200 * 10,
      `only ${stt.bytes} bytes reached the server`
    )
  })

  it('shows both sides of the conversation', async () => {
    await waitFor(
      () => client.conversation.length >= 3,
      'the assistant to answer'
    )

    const roles = client.conversation.map((item) => item.role)
    assert.deepEqual(roles.slice(0, 3), ['assistant', 'user', 'assistant'])

    const userMessage = client.conversation[1]
    assert.ok(
      'content' in userMessage &&
        userMessage.content.endsWith('bytes of speech'),
      'the transcript came back from the server'
    )
  })

  it('plays the answer of the assistant', async () => {
    await waitFor(
      () => speaker.played.length > playedBeforeAnswer,
      'the answer audio to be played'
    )
  })

  it('goes quiet while paused and speaks again on resume', async () => {
    client.pause()
    assert.equal(client.isPaused, true)
    assert.equal(client.isListening, false)

    const played = speaker.played.length
    await speak(0.5, true)
    assert.equal(client.isUserSpeaking, false, 'a paused call hears nothing')
    assert.equal(speaker.played.length, played)

    client.resume()
    assert.equal(client.isPaused, false)
  })

  it('mutes the microphone without dropping the call', async () => {
    client.mute()
    assert.equal(client.isMuted, true)
    assert.equal(client.isMicMuted, true)

    await speak(0.5, true)
    assert.equal(client.isUserSpeaking, false)

    client.unmute()
    assert.equal(client.isMuted, false)
  })

  it('moves the sound to another output', async () => {
    await client.changeSpeakerDevice('headphones')
    assert.equal(speaker.deviceId, 'headphones')
    assert.equal(client.state.speakerDeviceId, 'headphones')

    await client.changeSpeakerDevice('speaker')
    assert.equal(client.state.speakerDeviceId, 'speaker')
  })

  it('hangs up cleanly', async () => {
    await client.stop()
    assert.equal(client.isStarted, false)
    assert.equal(mic.isStarted, false)
    await waitFor(() => !server?.socket, 'the server to see the call end')
  })
})

describe('a call where the speaker pauses in the middle of a sentence', () => {
  let wss: WebSocketServer
  let url: string
  let mic: FakeMicDriver
  let client: MicdropClient
  let stt: CountingSTT
  let detector: FakeTurnDetector

  before(async () => {
    stt = new CountingSTT()
    wss = new WebSocketServer({ port: 0 })
    await new Promise((resolve) => wss.once('listening', resolve))
    url = `ws://localhost:${(wss.address() as AddressInfo).port}`
    wss.on('connection', (socket) => {
      new MicdropServer(socket, {
        agent: new MockAgent(),
        stt,
        tts: new ToneTTS(),
      })
    })

    mic = new FakeMicDriver()
    Mic.setDriver(mic)
    Speaker.setDriver(new FakeSpeakerDriver())
    // The first pause is the middle of a sentence, the second is the end of it
    detector = new FakeTurnDetector([false, true])
    client = new MicdropClient()
  })

  after(async () => {
    await client.stop()
    wss.close()
  })

  async function speak(seconds: number, loud: boolean) {
    const frames = Math.round(seconds * 100)
    for (let i = 0; i < frames; i++) {
      mic.push(loud ? sine(0.01, { amplitude: 0.4 }) : silence(0.01), 16000)
      if (i % 10 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  it('leaves the turn open while the sentence sounds unfinished', async () => {
    await client.start({ url, turnDetector: detector })
    await waitFor(() => client.isStarted, 'the call to start')

    await speak(1, true)
    await speak(1, false)
    await waitFor(() => detector.questions >= 1, 'the model to be asked')

    await new Promise((resolve) => setTimeout(resolve, 200))
    assert.equal(stt.bytes, 0, 'the server was never told the turn was over')
    assert.equal(detector.questions, 1)
  })

  it('answers once the sentence lands', async () => {
    await speak(1, true)
    await speak(1, false)

    await waitFor(
      () => client.conversation.some((item) => item.role === 'user'),
      'the transcript to come back'
    )

    const users = client.conversation.filter((item) => item.role === 'user')
    assert.equal(users.length, 1, 'the two stretches make one message')
    assert.equal(stt.streams, 1, 'the server kept the same stream open')
    assert.equal(detector.resets, 1, 'it was one turn all along')
  })
})

describe('a call where the server weighs the turn', () => {
  let wss: WebSocketServer
  let url: string
  let mic: FakeMicDriver
  let speaker: FakeSpeakerDriver
  let client: MicdropClient
  let stt: CountingSTT
  let detector: FakeTurnDetector

  before(async () => {
    stt = new CountingSTT()
    detector = new FakeTurnDetector([false, true])
    wss = new WebSocketServer({ port: 0 })
    await new Promise((resolve) => wss.once('listening', resolve))
    url = `ws://localhost:${(wss.address() as AddressInfo).port}`
    wss.on('connection', (socket) => {
      new MicdropServer(socket, {
        agent: new MockAgent(),
        stt,
        tts: new ToneTTS(),
        turnDetector: detector,
        // Short enough for a test, long enough not to fire on its own
        turnMaxWait: 1500,
      })
    })

    mic = new FakeMicDriver()
    speaker = new FakeSpeakerDriver()
    Mic.setDriver(mic)
    Speaker.setDriver(speaker)
    client = new MicdropClient()
  })

  after(async () => {
    await client.stop()
    wss.close()
  })

  async function speak(seconds: number, loud: boolean) {
    const frames = Math.round(seconds * 100)
    for (let i = 0; i < frames; i++) {
      mic.push(loud ? sine(0.01, { amplitude: 0.4 }) : silence(0.01), 16000)
      if (i % 10 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  it('holds the answer back while the sentence sounds unfinished', async () => {
    await client.start({ url })
    await waitFor(() => client.isStarted, 'the call to start')

    await speak(1, true)
    await speak(1, false)
    await waitFor(() => detector.questions >= 1, 'the model to be asked')
    await waitFor(
      () => client.conversation.some((item) => item.role === 'user'),
      'the transcript to come back'
    )

    await new Promise((resolve) => setTimeout(resolve, 200))
    assert.equal(
      client.conversation.some((item) => item.role === 'assistant'),
      false,
      'the assistant said nothing yet'
    )
  })

  it('answers once the next stretch lands', async () => {
    await speak(1, true)
    await speak(1, false)

    await waitFor(
      () => client.conversation.some((item) => item.role === 'assistant'),
      'the assistant to answer'
    )
    // The client closed its turn twice, so the server saw two messages
    assert.equal(stt.streams, 2)
  })
})

describe('a call where the speaker never finishes their sentence', () => {
  let wss: WebSocketServer
  let url: string
  let mic: FakeMicDriver
  let client: MicdropClient
  let detector: FakeTurnDetector

  before(async () => {
    // The server hears an unfinished sentence and keeps hearing one
    detector = new FakeTurnDetector([false])
    wss = new WebSocketServer({ port: 0 })
    await new Promise((resolve) => wss.once('listening', resolve))
    url = `ws://localhost:${(wss.address() as AddressInfo).port}`
    wss.on('connection', (socket) => {
      new MicdropServer(socket, {
        agent: new MockAgent(),
        stt: new CountingSTT(),
        tts: new ToneTTS(),
        turnDetector: detector,
        turnMaxWait: 600,
      })
    })

    mic = new FakeMicDriver()
    Mic.setDriver(mic)
    Speaker.setDriver(new FakeSpeakerDriver())
    client = new MicdropClient()
  })

  after(async () => {
    await client.stop()
    wss.close()
  })

  async function speak(seconds: number, loud: boolean) {
    const frames = Math.round(seconds * 100)
    for (let i = 0; i < frames; i++) {
      mic.push(loud ? sine(0.01, { amplitude: 0.4 }) : silence(0.01), 16000)
      if (i % 10 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  it('answers anyway once the deadline runs out', async () => {
    await client.start({ url })
    await waitFor(() => client.isStarted, 'the call to start')

    await speak(1, true)
    await speak(1, false)
    await waitFor(() => detector.questions >= 1, 'the model to be asked')

    // The rest never comes, so the agent stops waiting for it
    await waitFor(
      () => client.conversation.some((item) => item.role === 'assistant'),
      'the agent to answer on its own',
      4000
    )
  })
})

import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { MicRecorder } from '../src/audio/MicRecorder'
import { pcm16ToFloat } from '../src/audio/pcm'
import {
  FakeMicSource,
  FakeTurnDetector,
  ManualVAD,
  silence,
  sine,
} from './fakes'

const CHUNK_SAMPLES = 1600 // 100 ms at 16 kHz

describe('MicRecorder', () => {
  let mic: FakeMicSource
  let vad: ManualVAD
  let recorder: MicRecorder
  let chunks: Int16Array[]
  let events: string[]

  beforeEach(async () => {
    mic = new FakeMicSource()
    vad = new ManualVAD()
    recorder = new MicRecorder(vad)
    chunks = []
    events = []
    recorder.on('Chunk', (chunk) => chunks.push(chunk))
    recorder.on('StartSpeaking', () => events.push('StartSpeaking'))
    recorder.on('StopSpeaking', () => events.push('StopSpeaking'))
    await recorder.start(mic)
  })

  /** Feeds `seconds` of audio in 10 ms frames, as a recorder would */
  function feed(seconds: number, loud: boolean, sampleRate = 16000) {
    const frameLength = Math.round(0.01 * sampleRate)
    const frames = Math.round((seconds * 1000) / 10)
    for (let i = 0; i < frames; i++) {
      const samples = loud
        ? sine(0.01, { amplitude: 0.4, sampleRate })
        : silence(0.01, sampleRate)
      mic.emit('Frames', samples, sampleRate)
      assert.equal(samples.length, frameLength)
    }
  }

  it('starts ready to record', () => {
    assert.equal(recorder.state.isStarted, true)
    assert.equal(recorder.state.isSpeaking, false)
  })

  it('sends nothing while nobody speaks', () => {
    feed(1, false)
    assert.equal(chunks.length, 0)
  })

  it('holds the chunks back until the speech is confirmed', () => {
    feed(0.5, false)
    vad.emit('StartSpeaking')
    feed(0.3, true)
    assert.equal(chunks.length, 0, 'nothing leaves before ConfirmSpeaking')

    vad.emit('ConfirmSpeaking')
    assert.deepEqual(events, ['StartSpeaking'])
    assert.ok(chunks.length > 0, 'the queued chunks are released at once')
  })

  it('keeps as much reserve as the VAD says it needs', async () => {
    // The reserve is what saves the first syllable: a VAD that takes 300 ms to
    // make up its mind needs 300 ms of audio kept behind it
    const slow = new ManualVAD()
    slow.delay = 300
    const slowRecorder = new MicRecorder(slow)
    const slowChunks: Int16Array[] = []
    slowRecorder.on('Chunk', (chunk) => slowChunks.push(chunk))
    await slowRecorder.start(mic)

    // A full second of speech nobody has noticed yet
    for (let i = 0; i < 100; i++) {
      mic.emit('Frames', sine(0.01, { amplitude: 0.4 }), 16000)
    }
    slow.emit('StartSpeaking')
    slow.emit('ConfirmSpeaking')

    const sent = slowChunks.reduce((sum, chunk) => sum + chunk.length, 0)
    assert.equal(sent, 3 * CHUNK_SAMPLES, '300 ms of reserve was sent')
  })

  it('sends the moment before the VAD reacted', () => {
    // 100 ms of reserve is kept, which is the VAD delay
    feed(1, true)
    assert.equal(chunks.length, 0)

    vad.emit('StartSpeaking')
    vad.emit('ConfirmSpeaking')
    const sent = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    assert.equal(sent, CHUNK_SAMPLES, 'the reserve was sent, and only it')

    // And it holds sound, not the silence of a freshly opened buffer
    const level = Math.max(...pcm16ToFloat(chunks[0]))
    assert.ok(level > 0.3, `expected the reserve to hold speech, got ${level}`)
  })

  it('keeps the reserve through a false start', () => {
    // A breath opens a turn that the VAD then cancels, and the real sentence
    // follows at once. It still gets the moment before the VAD reacted.
    feed(1, false)
    vad.emit('StartSpeaking')
    vad.emit('CancelSpeaking')
    feed(0.05, true)

    vad.emit('StartSpeaking')
    vad.emit('ConfirmSpeaking')
    const sent = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    assert.equal(sent, CHUNK_SAMPLES, 'a full reserve was sent')
  })

  it('holds back only the recent audio while the speech is unconfirmed', () => {
    // A VAD that stays unsure for seconds, in a noisy room, only sends what may
    // be the beginning of the sentence: the reserve and CONFIRM_MARGIN
    vad.emit('StartSpeaking')
    feed(3, true)
    vad.emit('ConfirmSpeaking')
    const sent = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    assert.equal(
      sent,
      4 * CHUNK_SAMPLES,
      '100 ms of delay and 300 ms of margin'
    )
  })

  it('leaves out what the speaker plays when asked to', () => {
    recorder.setSpeakerPlaying(true)
    feed(1, true)
    vad.emit('StartSpeaking')
    vad.emit('ConfirmSpeaking')
    feed(0.5, true)
    assert.equal(chunks.length, 0, 'nothing is sent while the speaker plays')

    // The echo lingers after the speaker stops
    recorder.setSpeakerPlaying(false)
    feed(0.3, true)
    assert.equal(chunks.length, 0, 'nothing is sent while the echo dies out')

    feed(0.1, true)
    assert.equal(chunks.length, 1, 'the microphone is heard again')
  })

  it('cuts the audio into 100 ms chunks', () => {
    vad.emit('StartSpeaking')
    vad.emit('ConfirmSpeaking')
    chunks.length = 0
    feed(1, true)
    assert.equal(chunks.length, 10)
    for (const chunk of chunks) {
      assert.equal(chunk.length, CHUNK_SAMPLES)
    }
  })

  it('resamples a 48 kHz microphone down to 16 kHz', () => {
    vad.emit('StartSpeaking')
    vad.emit('ConfirmSpeaking')
    chunks.length = 0
    feed(1, true, 48000)
    assert.equal(chunks.length, 10)
    for (const chunk of chunks) {
      assert.equal(chunk.length, CHUNK_SAMPLES)
    }
  })

  it('forgets what turned out to be noise', () => {
    feed(0.5, false)
    vad.emit('StartSpeaking')
    feed(0.5, true)
    vad.emit('CancelSpeaking')
    assert.equal(chunks.length, 0)

    // And it is not sent with the next turn either
    vad.emit('StartSpeaking')
    vad.emit('ConfirmSpeaking')
    const sent = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    assert.ok(sent <= CHUNK_SAMPLES, `${sent} samples came out of nowhere`)
  })

  it('sends the end of the sentence before closing the turn', () => {
    vad.emit('StartSpeaking')
    vad.emit('ConfirmSpeaking')
    chunks.length = 0
    events.length = 0

    // 250 ms, so two full chunks and a half one
    feed(0.25, true)
    assert.equal(chunks.length, 2)

    vad.emit('StopSpeaking')
    assert.equal(chunks.length, 3, 'the last half chunk is sent too')
    assert.equal(chunks[2].length, CHUNK_SAMPLES / 2)
    assert.deepEqual(events, ['StopSpeaking'])
    assert.equal(recorder.state.isSpeaking, false)
  })

  it('reports speaking state through StateChange', () => {
    const states: boolean[] = []
    recorder.on('StateChange', (state) => states.push(state.isSpeaking))
    vad.emit('StartSpeaking')
    vad.emit('ConfirmSpeaking')
    vad.emit('StopSpeaking')
    assert.deepEqual(states, [true, false])
  })

  it('sends nothing once stopped', () => {
    recorder.stop()
    assert.equal(recorder.state.isStarted, false)
    vad.emit('StartSpeaking')
    vad.emit('ConfirmSpeaking')
    feed(1, true)
    assert.equal(chunks.length, 0)
  })

  it('starts a second turn from scratch', () => {
    vad.emit('StartSpeaking')
    vad.emit('ConfirmSpeaking')
    feed(0.5, true)
    vad.emit('StopSpeaking')
    const first = chunks.length
    chunks.length = 0

    feed(0.5, false)
    vad.emit('StartSpeaking')
    vad.emit('ConfirmSpeaking')
    feed(0.5, true)
    vad.emit('StopSpeaking')
    assert.ok(first > 0 && chunks.length > 0)
  })
})

describe('MicRecorder with a turn detector', () => {
  let mic: FakeMicSource
  let vad: ManualVAD
  let detector: FakeTurnDetector
  let recorder: MicRecorder
  let chunks: Int16Array[]
  let events: string[]

  /** Lets the detector answer, since it is asked asynchronously */
  const settle = () => new Promise((resolve) => setImmediate(resolve))

  async function setup(answers: boolean[], maxWait?: number) {
    mic = new FakeMicSource()
    vad = new ManualVAD()
    detector = new FakeTurnDetector(answers)
    recorder = new MicRecorder(vad, detector, maxWait)
    chunks = []
    events = []
    recorder.on('Chunk', (chunk) => chunks.push(chunk))
    recorder.on('StartSpeaking', () => events.push('StartSpeaking'))
    recorder.on('StopSpeaking', () => events.push('StopSpeaking'))
    await recorder.start(mic)
  }

  function feed(seconds: number, loud: boolean, sampleRate = 16000) {
    const frames = Math.round((seconds * 1000) / 10)
    for (let i = 0; i < frames; i++) {
      mic.emit(
        'Frames',
        loud
          ? sine(0.01, { amplitude: 0.4, sampleRate })
          : silence(0.01, sampleRate),
        sampleRate
      )
    }
  }

  /** One spoken stretch, from the first syllable to the pause after it */
  async function speak(seconds: number) {
    vad.emit('StartSpeaking')
    feed(seconds, true)
    vad.emit('ConfirmSpeaking')
    vad.emit('StopSpeaking')
    await settle()
  }

  it('ends the turn as usual when the sentence sounds finished', async () => {
    await setup([true])
    await speak(0.5)
    assert.deepEqual(events, ['StartSpeaking', 'StopSpeaking'])
    assert.equal(detector.questions, 1)
  })

  it('holds the turn open when the sentence sounds unfinished', async () => {
    await setup([false, true])
    await speak(0.5)
    assert.deepEqual(events, ['StartSpeaking'], 'the server is not told yet')

    feed(0.4, false)
    await speak(0.5)
    assert.deepEqual(events, ['StartSpeaking', 'StopSpeaking'])
  })

  it('opens the turn once, however many pauses it holds', async () => {
    await setup([false, false, true])
    await speak(0.4)
    feed(0.3, false)
    await speak(0.4)
    feed(0.3, false)
    await speak(0.4)
    assert.deepEqual(events, ['StartSpeaking', 'StopSpeaking'])
  })

  it('keeps the silence out of the stream while the turn stays open', async () => {
    await setup([false, true])
    await speak(0.5)
    const sent = chunks.length

    feed(1, false)
    assert.equal(chunks.length, sent, 'a pause is still worth nothing to send')

    await speak(0.5)
    assert.ok(chunks.length > sent, 'the rest of the sentence goes out')
  })

  it('lets the model hear the pause the server never receives', async () => {
    await setup([false, true])
    await speak(0.5)
    const heardBefore = detector.seconds

    feed(1, false)
    assert.ok(
      detector.seconds > heardBefore + 0.9,
      `the model heard ${detector.seconds - heardBefore} s of the pause`
    )
    assert.equal(detector.resets, 1, 'the turn is still the same one')
  })

  it('closes the turn on its own when the speaker never comes back', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    await setup([false], 1500)
    await speak(0.5)
    assert.deepEqual(events, ['StartSpeaking'])

    t.mock.timers.tick(1499)
    assert.deepEqual(events, ['StartSpeaking'])
    t.mock.timers.tick(1)
    assert.deepEqual(events, ['StartSpeaking', 'StopSpeaking'])
  })

  it('starts a new turn once the previous one is answered', async () => {
    await setup([true])
    await speak(0.4)
    await speak(0.4)
    assert.deepEqual(events, [
      'StartSpeaking',
      'StopSpeaking',
      'StartSpeaking',
      'StopSpeaking',
    ])
    assert.equal(detector.resets, 2)
  })

  it('drops a pending close when the speaker starts again', async () => {
    await setup([false, false])
    await speak(0.4)
    vad.emit('StartSpeaking')
    feed(0.3, true)
    vad.emit('ConfirmSpeaking')
    assert.deepEqual(events, ['StartSpeaking'], 'still the same turn')
  })

  it('ends the turn without asking when the microphone stops', async () => {
    await setup([false])
    vad.emit('StartSpeaking')
    feed(0.5, true)
    vad.emit('ConfirmSpeaking')

    await vad.stop()
    vad.emit('StopSpeaking')
    await settle()
    assert.deepEqual(events, ['StartSpeaking', 'StopSpeaking'])
    assert.equal(detector.questions, 0, 'a stopped call has nothing to weigh')
  })

  it('ends the turn without asking when the call is paused', async () => {
    await setup([false])
    vad.emit('StartSpeaking')
    feed(0.5, true)
    vad.emit('ConfirmSpeaking')

    await vad.pause()
    vad.emit('StopSpeaking')
    await settle()
    assert.deepEqual(events, ['StartSpeaking', 'StopSpeaking'])
    assert.equal(detector.questions, 0)
  })
})

describe('MicRecorder switching detector', () => {
  let mic: FakeMicSource
  let vad: ManualVAD
  let recorder: MicRecorder
  let events: string[]

  const settle = () => new Promise((resolve) => setImmediate(resolve))

  beforeEach(async () => {
    mic = new FakeMicSource()
    vad = new ManualVAD()
    recorder = new MicRecorder(vad)
    events = []
    recorder.on('StartSpeaking', () => events.push('StartSpeaking'))
    recorder.on('StopSpeaking', () => events.push('StopSpeaking'))
    await recorder.start(mic)
  })

  function say() {
    vad.emit('StartSpeaking')
    for (let i = 0; i < 30; i++) {
      mic.emit('Frames', sine(0.01, { amplitude: 0.4 }), 16000)
    }
    vad.emit('ConfirmSpeaking')
  }

  it('goes back to closing turns on silence once the detector leaves', async () => {
    const detector = new FakeTurnDetector([false])
    recorder.changeTurnDetector(detector)
    say()
    vad.emit('StopSpeaking')
    await settle()
    assert.deepEqual(events, ['StartSpeaking'], 'the turn is being held')

    recorder.changeTurnDetector(undefined)
    assert.deepEqual(events, ['StartSpeaking', 'StopSpeaking'], 'and released')

    say()
    vad.emit('StopSpeaking')
    await settle()
    assert.deepEqual(events, [
      'StartSpeaking',
      'StopSpeaking',
      'StartSpeaking',
      'StopSpeaking',
    ])
    assert.equal(detector.questions, 1, 'it was asked nothing more')
  })

  it('starts weighing turns as soon as a detector arrives', async () => {
    const detector = new FakeTurnDetector([false, true])
    recorder.changeTurnDetector(detector)
    say()
    vad.emit('StopSpeaking')
    await settle()
    assert.deepEqual(events, ['StartSpeaking'])
    assert.ok(detector.seconds > 0, 'it heard the sentence it was asked about')
  })
})

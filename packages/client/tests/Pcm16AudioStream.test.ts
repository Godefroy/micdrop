import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import { Pcm16AudioStream } from '../src/audio/Pcm16AudioStream'
import { floatToPcm16 } from '../src/audio/pcm'
import { FakeAudioSink, sine } from './fakes'

/** Builds `ms` of speech as the server sends it: 16 kHz mono PCM16 */
function speech(ms: number): Int16Array {
  return floatToPcm16(sine(ms / 1000, { amplitude: 0.5, sampleRate: 16000 }))
}

describe('Pcm16AudioStream', () => {
  let sink: FakeAudioSink
  let stream: Pcm16AudioStream
  let events: string[]

  beforeEach(() => {
    mock.timers.enable({ apis: ['setTimeout'] })
    sink = new FakeAudioSink(48000)
    stream = new Pcm16AudioStream(sink)
    events = []
    stream.on('StartPlaying', () => events.push('StartPlaying'))
    stream.on('StopPlaying', () => events.push('StopPlaying'))
  })

  afterEach(() => {
    mock.timers.reset()
  })

  it('resamples what the server sends to the rate of the audio graph', () => {
    stream.playAudio(speech(200), 16000)
    assert.equal(sink.scheduled.length, 1)
    // 200 ms at 48 kHz
    assert.equal(sink.scheduled[0].samples.length, 9600)
  })

  it('waits for enough audio before starting to play', () => {
    stream.playAudio(speech(40), 16000)
    assert.equal(sink.scheduled.length, 0, 'too short to start on')
    assert.deepEqual(events, [])

    stream.playAudio(speech(80), 16000)
    assert.equal(sink.scheduled.length, 2, 'both chunks go out at once')
    assert.deepEqual(events, ['StartPlaying'])
  })

  it('plays a short answer anyway when nothing else comes', () => {
    stream.playAudio(speech(40), 16000)
    assert.equal(sink.scheduled.length, 0)

    mock.timers.tick(600)
    assert.equal(sink.scheduled.length, 1)
    assert.deepEqual(events, ['StartPlaying'])
  })

  it('queues each chunk right after the previous one', () => {
    stream.playAudio(speech(200), 16000)
    stream.playAudio(speech(200), 16000)
    stream.playAudio(speech(200), 16000)

    assert.deepEqual(
      sink.scheduled.map((entry) => entry.when),
      [0, 0.2, 0.4]
    )
  })

  it('does not schedule in the past when the clock has moved on', () => {
    stream.playAudio(speech(200), 16000)
    sink.advanceTo(5)
    stream.playAudio(speech(200), 16000)
    assert.equal(sink.scheduled[sink.scheduled.length - 1].when, 5)
  })

  it('reports the assistant as quiet once everything has played', () => {
    stream.playAudio(speech(200), 16000)
    assert.equal(stream.isPlaying, true)

    sink.advanceTo(0.2)
    assert.equal(stream.isPlaying, false)
    assert.deepEqual(events, ['StartPlaying', 'StopPlaying'])
  })

  it('plays a chunk that arrives late without waiting for a new buffer', () => {
    stream.playAudio(speech(200), 16000)
    sink.advanceTo(0.2)
    assert.deepEqual(events, ['StartPlaying', 'StopPlaying'])

    // 100 ms later, still inside the window that tells a hole from an ending
    mock.timers.tick(100)
    stream.playAudio(speech(40), 16000)
    assert.equal(sink.scheduled.length, 1, 'heard right away')
    assert.deepEqual(events, ['StartPlaying', 'StopPlaying', 'StartPlaying'])
  })

  it('waits again for a full buffer when a new answer starts', () => {
    stream.playAudio(speech(200), 16000)
    sink.advanceTo(0.2)

    // Long enough for the utterance to be over
    mock.timers.tick(400)
    stream.playAudio(speech(40), 16000)
    assert.equal(sink.scheduled.length, 0, 'a fresh answer is buffered again')
  })

  it('drops everything when the user interrupts', () => {
    stream.playAudio(speech(200), 16000)
    stream.playAudio(speech(200), 16000)
    const scheduled = [...sink.scheduled]

    stream.stopAudio()
    assert.ok(scheduled.every((entry) => entry.stopped))
    assert.equal(stream.isPlaying, false)
    assert.deepEqual(events, ['StartPlaying', 'StopPlaying'])

    // The next answer starts on a clean timeline
    sink.scheduled.length = 0
    stream.playAudio(speech(200), 16000)
    assert.equal(sink.scheduled[0].when, 0)
  })

  it('ignores an empty chunk', () => {
    stream.playAudio(new Int16Array(0), 16000)
    assert.equal(sink.scheduled.length, 0)
    assert.deepEqual(events, [])
  })

  it('empties the meter once the assistant stops speaking', () => {
    const volumes: number[] = []
    stream.on('Volume', (volume) => volumes.push(volume))
    stream.playAudio(speech(200), 16000)

    mock.timers.tick(200)
    assert.ok(volumes.length > 0 && volumes[volumes.length - 1] > -60)

    sink.advanceTo(0.2)
    assert.equal(
      volumes[volumes.length - 1],
      -Infinity,
      'the level meter would stay lit on the last thing played'
    )
  })

  it('reports the level of what is being heard', () => {
    const volumes: number[] = []
    stream.on('Volume', (volume) => volumes.push(volume))
    stream.playAudio(speech(300), 16000)

    assert.deepEqual(volumes, [], 'nothing is heard yet')
    mock.timers.tick(300)
    assert.equal(volumes.length, 3, 'one level per 100 ms of audio')
    for (const volume of volumes) {
      assert.ok(volume > -20 && volume < 0, `got ${volume}`)
    }
  })
})

describe('Pcm16AudioStream warming up', () => {
  let sink: FakeAudioSink
  let stream: Pcm16AudioStream
  let events: string[]

  beforeEach(() => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
    sink = new FakeAudioSink(48000)
    stream = new Pcm16AudioStream(sink)
    events = []
    stream.on('StartPlaying', () => events.push('StartPlaying'))
  })

  afterEach(() => {
    stream.destroy()
    mock.timers.reset()
  })

  it('plays silence without reporting the assistant as speaking', () => {
    stream.warmUp(2000)
    assert.equal(sink.scheduled.length, 1)
    assert.equal(sink.scheduled[0].samples.length, 96000, '2 s at 48 kHz')
    assert.ok(sink.scheduled[0].samples.every((sample) => sample === 0))
    assert.deepEqual(events, [])
    assert.equal(stream.isPlaying, false)
  })

  it('holds an answer that arrives during the warm-up until it is over', () => {
    stream.warmUp(2000)
    mock.timers.tick(500)
    stream.playAudio(speech(200), 16000)
    stream.playAudio(speech(100), 16000)
    assert.equal(sink.scheduled.length, 1, 'only the silence so far')

    mock.timers.tick(1500)
    assert.equal(sink.scheduled.length, 3, 'both chunks, one after the other')
    assert.equal(sink.scheduled[2].when, sink.scheduled[1].when + 0.2)
    assert.deepEqual(events, ['StartPlaying'])
  })

  it('plays an answer that arrives after the warm-up right away', () => {
    stream.warmUp(2000)
    mock.timers.tick(2500)
    stream.playAudio(speech(200), 16000)
    assert.equal(sink.scheduled.length, 2)
  })

  it('drops an answer held by the warm-up when the user interrupts', () => {
    stream.warmUp(2000)
    stream.playAudio(speech(200), 16000)
    stream.stopAudio()
    mock.timers.tick(2000)
    assert.equal(sink.scheduled.length, 1, 'only the silence')
    assert.deepEqual(events, [])
  })

  it('stops the silence once destroyed', () => {
    stream.warmUp(2000)
    stream.destroy()
    assert.equal(sink.scheduled[0].stopped, true)
  })
})

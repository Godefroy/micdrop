import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import {
  SILERO_FRAME_SAMPLES,
  SileroModel,
  SileroVAD,
  setSileroModelLoader,
} from '../src/audio/vad/SileroVAD'
import { VADStatus } from '../src/audio/vad/VAD'
import { FakeMicSource } from './fakes'

/** A model that answers whatever the test scripted, one window at a time */
class ScriptedModel implements SileroModel {
  public probabilities: number[] = []
  public resets = 0
  public released = false
  private index = 0

  async process(_frame: Float32Array) {
    const probability = this.probabilities[this.index] ?? 0
    this.index++
    return probability
  }

  reset() {
    this.resets++
    this.index = 0
  }

  async release() {
    this.released = true
  }
}

const SPEECH = 0.9
const SILENCE = 0.02

describe('SileroVAD', () => {
  let model: ScriptedModel
  let mic: FakeMicSource
  let vad: SileroVAD
  let events: string[]

  /** Pushes `count` windows of audio, and lets the model answer for each */
  async function feed(count: number) {
    for (let i = 0; i < count; i++) {
      mic.emit('Frames', new Float32Array(SILERO_FRAME_SAMPLES), 16000)
    }
    // The model is asynchronous, let it drain
    for (let i = 0; i < count + 2; i++) await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  beforeEach(async () => {
    model = new ScriptedModel()
    setSileroModelLoader(async () => model)
    mic = new FakeMicSource()
    vad = new SileroVAD({
      positiveSpeechThreshold: 0.5,
      negativeSpeechThreshold: 0.3,
      minSpeechFrames: 3,
      redemptionFrames: 4,
    })
    events = []
    for (const name of [
      'StartSpeaking',
      'ConfirmSpeaking',
      'CancelSpeaking',
      'StopSpeaking',
    ] as const) {
      vad.on(name, () => events.push(name))
    }
    await vad.start(mic)
  })

  it('loads the model the platform provides', () => {
    assert.equal(vad.isStarted, true)
    assert.equal(model.resets, 1, 'it starts from a clean state')
  })

  it('refuses to start when no platform package was imported', async () => {
    setSileroModelLoader(undefined as never)
    await assert.rejects(() => new SileroVAD().start(mic))
    setSileroModelLoader(async () => model)
  })

  it('stays quiet while the model hears no voice', async () => {
    model.probabilities = new Array(10).fill(SILENCE)
    await feed(10)
    assert.deepEqual(events, [])
    assert.equal(vad.status, VADStatus.Silence)
  })

  it('opens a turn on the first window of speech', async () => {
    model.probabilities = [SPEECH, SPEECH]
    await feed(2)
    assert.deepEqual(events, ['StartSpeaking'])
    assert.equal(vad.status, VADStatus.MaybeSpeaking)
  })

  it('confirms once there is enough speech', async () => {
    model.probabilities = new Array(4).fill(SPEECH)
    await feed(4)
    assert.deepEqual(events, ['StartSpeaking', 'ConfirmSpeaking'])
    assert.equal(vad.status, VADStatus.Speaking)
  })

  it('keeps the turn open through a pause between words', async () => {
    model.probabilities = [
      SPEECH,
      SPEECH,
      SPEECH,
      SILENCE,
      SILENCE,
      SILENCE,
      SPEECH,
      SPEECH,
    ]
    await feed(8)
    assert.deepEqual(
      events,
      ['StartSpeaking', 'ConfirmSpeaking'],
      'three quiet windows are a breath, not an ending'
    )
    assert.equal(vad.status, VADStatus.Speaking)
  })

  it('closes the turn once the silence lasts', async () => {
    model.probabilities = [
      SPEECH,
      SPEECH,
      SPEECH,
      SILENCE,
      SILENCE,
      SILENCE,
      SILENCE,
    ]
    await feed(7)
    assert.deepEqual(events, [
      'StartSpeaking',
      'ConfirmSpeaking',
      'StopSpeaking',
    ])
    assert.equal(vad.status, VADStatus.Silence)
  })

  it('drops a burst too short to be a sentence', async () => {
    model.probabilities = [SPEECH, SPEECH, SILENCE, SILENCE, SILENCE, SILENCE]
    await feed(6)
    assert.deepEqual(events, ['StartSpeaking', 'CancelSpeaking'])
    assert.equal(vad.status, VADStatus.Silence)
  })

  it('ignores the model between the two thresholds', async () => {
    // 0.4 is under the positive threshold and over the negative one, which is
    // the band where the model is unsure and the turn should not move
    model.probabilities = [SPEECH, SPEECH, SPEECH, 0.4, 0.4, 0.4, 0.4, 0.4]
    await feed(8)
    assert.deepEqual(events, ['StartSpeaking', 'ConfirmSpeaking'])
    assert.equal(vad.status, VADStatus.Speaking)
  })

  it('hears nothing while paused', async () => {
    await vad.pause()
    model.probabilities = new Array(6).fill(SPEECH)
    await feed(6)
    assert.deepEqual(events, [])

    await vad.resume()
    await feed(4)
    assert.deepEqual(events, ['StartSpeaking', 'ConfirmSpeaking'])
  })

  it('closes the turn it had opened when it is stopped', async () => {
    model.probabilities = new Array(4).fill(SPEECH)
    await feed(4)
    events.length = 0

    await vad.stop()
    assert.deepEqual(events, ['StopSpeaking'])
    assert.equal(model.released, true, 'the runtime is handed back')
    assert.equal(vad.isStarted, false)
  })

  it('gathers windows from a microphone at another rate', async () => {
    const processed: number[] = []
    model.process = async (frame: Float32Array) => {
      processed.push(frame.length)
      return SILENCE
    }
    // 48 kHz frames of 10 ms, so a 512 sample window at 16 kHz needs 1536 of them
    for (let i = 0; i < 10; i++) {
      mic.emit('Frames', new Float32Array(480), 48000)
    }
    await new Promise((resolve) => setTimeout(resolve, 0))

    assert.ok(processed.length >= 3, `only ${processed.length} windows scored`)
    for (const length of processed) {
      assert.equal(length, SILERO_FRAME_SAMPLES)
    }
  })

  it('lets go of the model of a start overtaken by a stop and a start', async () => {
    const models: ScriptedModel[] = []
    const releases: Array<() => void> = []
    setSileroModelLoader(
      () =>
        new Promise((resolve) => {
          const loaded = new ScriptedModel()
          models.push(loaded)
          releases.push(() => resolve(loaded))
        })
    )
    const ownMic = new FakeMicSource()
    const fresh = new SileroVAD()
    const first = fresh.start(ownMic)
    fresh.stop()
    const second = fresh.start(ownMic)
    releases.forEach((release) => release())
    await Promise.all([first, second])

    assert.equal(models.length, 2)
    assert.equal(models[0].released, true)
    assert.equal(models[1].released, false)
    // One listener, so every frame is heard once
    assert.equal(ownMic.listenerCount('Frames'), 1)
    await fresh.stop()
  })
})

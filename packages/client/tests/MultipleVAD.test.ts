import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { MultipleVAD } from '../src/audio/vad/MultipleVAD'
import { VADStatus } from '../src/audio/vad/VAD'
import { FakeMicSource, ManualVAD } from './fakes'

/** Closes the turn it was in when stopped, as Silero and the volume VAD do */
class ClosingVAD extends ManualVAD {
  async stop() {
    if (this.status === VADStatus.Speaking) this.emit('StopSpeaking')
    if (this.status === VADStatus.MaybeSpeaking) this.emit('CancelSpeaking')
    await super.stop()
  }
}

describe('MultipleVAD', () => {
  let silero: ManualVAD
  let volume: ManualVAD
  let vad: MultipleVAD
  let events: string[]

  beforeEach(async () => {
    silero = new ManualVAD()
    volume = new ManualVAD()
    vad = new MultipleVAD([silero, volume])
    events = []
    for (const event of [
      'StartSpeaking',
      'ConfirmSpeaking',
      'CancelSpeaking',
      'StopSpeaking',
    ] as const) {
      vad.on(event, () => events.push(event))
    }
    await vad.start(new FakeMicSource())
  })

  it('keeps the reserve the slowest of its VADs needs', () => {
    const slow = new ManualVAD()
    slow.delay = 400
    assert.equal(new MultipleVAD([new ManualVAD(), slow]).delay, 400)
  })

  it('confirms a short word only one VAD is sure of', () => {
    // "No" is over before the volume VAD gathers enough loud reports to
    // confirm, while Silero confirms it
    silero.emit('StartSpeaking')
    volume.emit('StartSpeaking')
    silero.emit('ConfirmSpeaking')
    volume.emit('CancelSpeaking')
    silero.emit('StopSpeaking')
    assert.deepEqual(events, [
      'StartSpeaking',
      'ConfirmSpeaking',
      'StopSpeaking',
    ])
  })

  it('ignores what one VAD hears alone', () => {
    // Silero is sure of a voice the volume VAD finds too quiet
    silero.emit('StartSpeaking')
    silero.emit('ConfirmSpeaking')
    silero.emit('StopSpeaking')
    assert.deepEqual(events, ['StartSpeaking', 'CancelSpeaking'])
  })

  it('confirms when every VAD is sure', () => {
    silero.emit('StartSpeaking')
    volume.emit('StartSpeaking')
    silero.emit('ConfirmSpeaking')
    volume.emit('ConfirmSpeaking')
    assert.deepEqual(events, ['StartSpeaking', 'ConfirmSpeaking'])
    assert.equal(vad.status, VADStatus.Speaking)
  })

  it('keeps the turn open while one VAD still hears speech', () => {
    silero.emit('StartSpeaking')
    silero.emit('ConfirmSpeaking')
    volume.emit('StartSpeaking')
    volume.emit('ConfirmSpeaking')
    silero.emit('StopSpeaking')
    assert.deepEqual(events, ['StartSpeaking', 'ConfirmSpeaking'])

    volume.emit('StopSpeaking')
    assert.deepEqual(events, [
      'StartSpeaking',
      'ConfirmSpeaking',
      'StopSpeaking',
    ])
  })

  it('cancels when every VAD goes back to silence unsure', () => {
    silero.emit('StartSpeaking')
    volume.emit('StartSpeaking')
    silero.emit('CancelSpeaking')
    assert.deepEqual(events, ['StartSpeaking'], 'one VAD still hears it')

    volume.emit('CancelSpeaking')
    assert.deepEqual(events, ['StartSpeaking', 'CancelSpeaking'])
  })

  it('waits for the others when a VAD is sure straight away', () => {
    // The volume VAD may confirm without going through StartSpeaking
    volume.emit('ConfirmSpeaking')
    assert.deepEqual(events, ['StartSpeaking'])

    silero.emit('StartSpeaking')
    assert.deepEqual(events, ['StartSpeaking', 'ConfirmSpeaking'])
  })

  it('pauses and resumes every VAD', async () => {
    assert.equal(vad.isStarted, true)
    await vad.pause()
    assert.equal(silero.isPaused && volume.isPaused, true)
    assert.equal(vad.isPaused, true)

    await vad.resume()
    assert.equal(vad.isPaused, false)
    assert.equal(silero.isPaused || volume.isPaused, false)
  })

  it('closes the turn it was in when stopped', async () => {
    const a = new ClosingVAD()
    const b = new ClosingVAD()
    const closing = new MultipleVAD([a, b])
    const heard: string[] = []
    closing.on('StopSpeaking', () => heard.push('StopSpeaking'))
    await closing.start(new FakeMicSource())

    a.emit('ConfirmSpeaking')
    b.emit('ConfirmSpeaking')
    await closing.stop()
    assert.deepEqual(heard, ['StopSpeaking'])
    assert.equal(closing.status, VADStatus.Silence)
  })

  it('starts in silence after being stopped mid sentence', async () => {
    silero.emit('ConfirmSpeaking')
    volume.emit('ConfirmSpeaking')
    await vad.stop()
    // The VADs themselves start the next call in silence
    silero.status = VADStatus.Silence
    volume.status = VADStatus.Silence
    events = []

    await vad.start(new FakeMicSource())
    silero.emit('StartSpeaking')
    assert.deepEqual(events, ['StartSpeaking'])
  })

  it('listens to a VAD that was already started', async () => {
    const started = new ManualVAD()
    await started.start()
    const combined = new MultipleVAD([started])
    const heard: string[] = []
    combined.on('StartSpeaking', () => heard.push('StartSpeaking'))
    await combined.start(new FakeMicSource())

    started.emit('StartSpeaking')
    assert.deepEqual(heard, ['StartSpeaking'])
  })

  it('listens only once when started twice', async () => {
    await vad.start(new FakeMicSource())
    silero.emit('StartSpeaking')
    silero.emit('ConfirmSpeaking')
    volume.emit('StartSpeaking')
    assert.deepEqual(events, ['StartSpeaking', 'ConfirmSpeaking'])
  })
})

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ECHO_WATCH, EchoGuard } from '../src/client/EchoGuard'

describe('EchoGuard', () => {
  it('ignores what it hears before the assistant starts', () => {
    const guard = new EchoGuard()
    assert.equal(guard.speechHeard(0), false)
    assert.equal(guard.stage, 'normal')
  })

  it('steps up on speech heard during the first watch', () => {
    const guard = new EchoGuard()
    guard.speakerStarted(0)
    assert.equal(guard.speechHeard(ECHO_WATCH - 1), true)
    assert.equal(guard.stage, 'fallback')
  })

  it('lets through speech once the watch is over', () => {
    const guard = new EchoGuard()
    guard.speakerStarted(0)
    assert.equal(guard.speechHeard(ECHO_WATCH), false)
    assert.equal(guard.stage, 'normal')
  })

  it('stops watching when a first answer ends early', () => {
    const guard = new EchoGuard()
    guard.speakerStarted(0)
    guard.speakerStopped(500)
    guard.speakerStarted(1000)
    assert.equal(guard.speechHeard(1100), false)
    assert.equal(guard.stage, 'normal')
  })

  it('gives up on interruptions on a second echo after the new route', () => {
    const guard = new EchoGuard()
    guard.speakerStarted(0)
    guard.speechHeard(500)
    assert.equal(guard.speechHeard(500 + ECHO_WATCH - 1), true)
    assert.equal(guard.stage, 'disabled')
    assert.equal(guard.speechHeard(500 + ECHO_WATCH), false)
  })

  it('trusts the new route once it has been heard long enough', () => {
    const guard = new EchoGuard()
    guard.speakerStarted(0)
    guard.speechHeard(500)
    assert.equal(guard.speechHeard(500 + ECHO_WATCH), false)
    assert.equal(guard.stage, 'fallback')
    guard.speakerStopped(5000)
    guard.speakerStarted(6000)
    assert.equal(guard.speechHeard(6100), false)
  })

  it('carries the watch to the next answer when the new route was cut short', () => {
    const guard = new EchoGuard()
    guard.speakerStarted(0)
    guard.speechHeard(500)
    guard.speakerStopped(1000)
    assert.equal(guard.speechHeard(1100), false)
    guard.speakerStarted(5000)
    assert.equal(guard.speechHeard(5100), true)
    assert.equal(guard.stage, 'disabled')
  })

  it('starts over after a reset', () => {
    const guard = new EchoGuard()
    guard.speakerStarted(0)
    guard.speechHeard(500)
    guard.reset()
    assert.equal(guard.stage, 'normal')
    guard.speakerStarted(1000)
    assert.equal(guard.speechHeard(1100), true)
  })
})

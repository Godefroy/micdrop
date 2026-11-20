import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Pcm16Aligner } from '../src/index'

describe('Pcm16Aligner', () => {
  it('passes chunks of whole samples through', () => {
    const aligner = new Pcm16Aligner()
    const chunk = Buffer.from([1, 2, 3, 4])
    assert.deepEqual(aligner.process(chunk), chunk)
  })

  it('carries a split sample over to the next chunk', () => {
    const aligner = new Pcm16Aligner()
    assert.deepEqual(
      aligner.process(Buffer.from([1, 2, 3])),
      Buffer.from([1, 2])
    )
    assert.deepEqual(aligner.process(Buffer.from([4])), Buffer.from([3, 4]))
    assert.deepEqual(aligner.process(Buffer.from([5])), Buffer.alloc(0))
    assert.deepEqual(
      aligner.process(Buffer.from([6, 7, 8])),
      Buffer.from([5, 6, 7, 8])
    )
  })

  it('forgets the held byte on reset', () => {
    const aligner = new Pcm16Aligner()
    aligner.process(Buffer.from([1]))
    aligner.reset()
    assert.deepEqual(aligner.process(Buffer.from([2, 3])), Buffer.from([2, 3]))
  })
})

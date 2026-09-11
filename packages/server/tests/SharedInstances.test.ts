import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { SharedInstances } from '../src/SharedInstances'

describe('SharedInstances', () => {
  it('loads once per key and shares the instance', async () => {
    const instances = new SharedInstances<string>()
    let calls = 0
    const create = async () => {
      calls++
      return `instance ${calls}`
    }

    const first = await instances.load(['model', 'cpu'], create)
    const second = await instances.load(['model', 'cpu'], create)

    assert.equal(calls, 1)
    assert.equal(first, 'instance 1')
    assert.equal(second, 'instance 1')
  })

  it('loads one instance per configuration', async () => {
    const instances = new SharedInstances<string>()
    let calls = 0
    const create = async () => `instance ${++calls}`

    await instances.load(['model', 'cpu'], create)
    await instances.load(['model', 'webgpu'], create)
    await instances.load(['other', 'cpu'], create)

    assert.equal(calls, 3)
  })

  it('shares one promise between concurrent callers', async () => {
    const instances = new SharedInstances<string>()
    let calls = 0
    const create = () =>
      new Promise<string>((resolve) => {
        calls++
        setTimeout(() => resolve('loaded'), 10)
      })

    const [a, b] = await Promise.all([
      instances.load('key', create),
      instances.load('key', create),
    ])

    assert.equal(calls, 1)
    assert.equal(a, 'loaded')
    assert.equal(b, 'loaded')
  })

  it('retries after a failed load rather than caching the failure', async () => {
    const instances = new SharedInstances<string>()
    let calls = 0
    const create = async () => {
      calls++
      if (calls === 1) throw new Error('download failed')
      return 'loaded'
    }

    await assert.rejects(() => instances.load('key', create), /download failed/)
    assert.equal(instances.has('key'), false)
    assert.equal(await instances.load('key', create), 'loaded')
    assert.equal(calls, 2)
  })

  it('reports a synchronous throw without keeping the entry', async () => {
    const instances = new SharedInstances<string>()

    await assert.rejects(
      () =>
        instances.load('key', () => {
          throw new Error('cannot even start')
        }),
      /cannot even start/
    )
    assert.equal(instances.has('key'), false)
  })

  it('forgets everything on clear', async () => {
    const instances = new SharedInstances<string>()
    let calls = 0
    const create = async () => `instance ${++calls}`

    await instances.load('key', create)
    instances.clear()
    await instances.load('key', create)

    assert.equal(calls, 2)
  })
})

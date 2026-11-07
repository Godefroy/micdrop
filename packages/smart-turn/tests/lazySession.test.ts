import assert from 'node:assert'
import { describe, it } from 'node:test'
import { createDownloadCache, LazySession } from '../src/lazySession'

/** A session that counts how often it was released */
class FakeSession {
  public released = 0

  async release() {
    this.released++
  }
}

/** A promise settled from the outside, to hold a load or a run in flight */
const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => (resolve = res))
  return { promise, resolve }
}

describe('LazySession', () => {
  it('creates one session, however many callers ask while it loads', async () => {
    let creates = 0
    const lazy = new LazySession('test', async () => {
      creates++
      return new FakeSession()
    })
    const [a, b] = await Promise.all([lazy.get(), lazy.get()])
    assert.equal(creates, 1)
    assert.equal(a, b)
    assert.equal(lazy.status, 'loaded')
  })

  it('disposes of a session that lands after release', async () => {
    const session = new FakeSession()
    const pending = deferred<FakeSession>()
    const lazy = new LazySession('test', () => pending.promise)

    const loading = lazy.get()
    await lazy.release()
    pending.resolve(session)

    await assert.rejects(() => loading, /released/)
    assert.equal(session.released, 1)
    assert.equal(lazy.status, 'released')
    await assert.rejects(() => lazy.get(), /released/)
  })

  it('waits for the runs in flight before releasing', async () => {
    const session = new FakeSession()
    const lazy = new LazySession('test', async () => session)
    const run = deferred<number>()

    const using = lazy.use(() => run.promise)
    await lazy.get()
    // Let the run register before the release
    await new Promise((resolve) => setImmediate(resolve))
    const releasing = lazy.release()
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(session.released, 0)

    run.resolve(42)
    assert.equal(await using, 42)
    await releasing
    assert.equal(session.released, 1)
  })

  it('tries again after a failed load', async () => {
    let creates = 0
    const lazy = new LazySession('test', async () => {
      if (++creates === 1) throw new Error('offline')
      return new FakeSession()
    })
    await assert.rejects(() => lazy.get(), /offline/)
    assert.equal(lazy.status, 'unloaded')
    await lazy.get()
    assert.equal(creates, 2)
  })
})

describe('createDownloadCache', () => {
  it('fetches each address once, and keeps addresses apart', async () => {
    const fetched: string[] = []
    const download = createDownloadCache(async (url) => {
      fetched.push(url)
      return url.toUpperCase()
    })
    assert.equal(await download('a'), 'A')
    assert.equal(await download('a'), 'A')
    assert.equal(await download('b'), 'B')
    assert.deepEqual(fetched, ['a', 'b'])
  })

  it('forgets a failed download', async () => {
    let attempts = 0
    const download = createDownloadCache(async () => {
      if (++attempts === 1) throw new Error('offline')
      return 'bytes'
    })
    await assert.rejects(() => download('a'), /offline/)
    assert.equal(await download('a'), 'bytes')
    assert.equal(attempts, 2)
  })
})

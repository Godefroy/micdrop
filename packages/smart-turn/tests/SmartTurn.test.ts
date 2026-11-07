import assert from 'node:assert'
import { describe, it } from 'node:test'
import { MEL_BANDS, MEL_FRAMES, SAMPLE_RATE } from '../src/mel'
import { SmartTurnModel, setSmartTurnModelLoader } from '../src/model'
import { SmartTurn } from '../src/SmartTurn'

/** A model that answers whatever it is told to, and remembers what it saw */
class FakeModel implements SmartTurnModel {
  public calls: Float32Array[] = []
  public released = 0

  constructor(public probability = 0.9) {}

  async predict(features: Float32Array) {
    this.calls.push(features.slice())
    return this.probability
  }

  async release() {
    this.released++
  }
}

/** A promise settled from the outside, to hold a load in flight */
const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => (resolve = res))
  return { promise, resolve }
}

const tone = (seconds: number, rate = SAMPLE_RATE) => {
  const samples = new Float32Array(Math.round(seconds * rate))
  for (let i = 0; i < samples.length; i++) {
    samples[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / rate)
  }
  return samples
}

describe('SmartTurn', () => {
  it('hands the model one value per band and per frame', async () => {
    const model = new FakeModel()
    const smartTurn = new SmartTurn({ model })
    smartTurn.push(tone(2))
    const result = await smartTurn.predict()

    assert.equal(model.calls.length, 1)
    assert.equal(model.calls[0].length, MEL_BANDS * MEL_FRAMES)
    assert.equal(result.probability, 0.9)
    assert.equal(result.complete, true)
    assert.ok(result.duration >= 0)
  })

  it('calls the turn finished above the threshold and open below it', async () => {
    const model = new FakeModel(0.6)
    assert.equal((await new SmartTurn({ model }).predict()).complete, true)
    assert.equal(
      (await new SmartTurn({ model, threshold: 0.8 }).predict()).complete,
      false
    )
  })

  it('resamples audio that does not arrive at 16 kHz', async () => {
    const model = new FakeModel()
    const smartTurn = new SmartTurn({ model })
    smartTurn.push(tone(1, 48000), 48000)
    assert.ok(Math.abs(smartTurn.seconds - 1) < 0.01)
  })

  it('starts over on reset', async () => {
    const model = new FakeModel()
    const smartTurn = new SmartTurn({ model })
    smartTurn.push(tone(3))
    smartTurn.reset()
    assert.equal(smartTurn.seconds, 0)
  })

  it('scores a turn it was never fed', async () => {
    const model = new FakeModel()
    const smartTurn = new SmartTurn({ model })
    await smartTurn.predictOnce(tone(2))
    assert.equal(model.calls[0].length, MEL_BANDS * MEL_FRAMES)
  })

  it('loads the model of the platform once, however many turns ask', async () => {
    const model = new FakeModel()
    let loads = 0
    setSmartTurnModelLoader(async () => {
      loads++
      return model
    })

    const smartTurn = new SmartTurn()
    await Promise.all([
      smartTurn.predict(),
      smartTurn.predict(),
      smartTurn.predict(),
    ])
    assert.equal(loads, 1)

    await smartTurn.release()
    assert.equal(model.released, 1)
  })

  it('explains itself when no platform registered a model', async () => {
    setSmartTurnModelLoader(undefined as never)
    await assert.rejects(() => new SmartTurn().predict(), /No Smart Turn model/)
  })

  it('shares one registry across the platform entry points', async () => {
    // Each entry point is bundled on its own, so the registry has to live
    // somewhere both copies of the module can reach
    const model = new FakeModel()
    setSmartTurnModelLoader(async () => model)
    const scope = globalThis as { micdropSmartTurnLoader?: unknown }
    assert.ok(scope.micdropSmartTurnLoader, 'the loader is reachable globally')
    await new SmartTurn().predict()
    assert.equal(model.calls.length, 1)
  })

  it('releases a model that lands after release, instead of reviving it', async () => {
    const first = new FakeModel()
    const second = new FakeModel()
    const pending = deferred<FakeModel>()
    let loads = 0
    setSmartTurnModelLoader(() =>
      ++loads === 1 ? pending.promise : Promise.resolve(second)
    )

    const smartTurn = new SmartTurn()
    const loading = smartTurn.load()
    await smartTurn.release()
    pending.resolve(first)

    await assert.rejects(() => loading, /released/)
    assert.equal(first.released, 1)

    // The next turn loads a fresh model rather than the released one
    await smartTurn.predict()
    assert.equal(loads, 2)
    assert.equal(first.calls.length, 0)
    assert.equal(second.calls.length, 1)
  })

  it('tries the load again after a failure', async () => {
    const model = new FakeModel()
    let loads = 0
    setSmartTurnModelLoader(async () => {
      if (++loads === 1) throw new Error('offline')
      return model
    })

    const smartTurn = new SmartTurn()
    await assert.rejects(() => smartTurn.predict(), /offline/)
    await smartTurn.predict()
    assert.equal(loads, 2)
    assert.equal(model.calls.length, 1)
  })

  it('leaves a model it was given to the caller', async () => {
    const model = new FakeModel()
    const smartTurn = new SmartTurn({ model })
    await smartTurn.release()
    assert.equal(model.released, 0)

    // And keeps using it
    await smartTurn.predict()
    assert.equal(model.calls.length, 1)
  })
})

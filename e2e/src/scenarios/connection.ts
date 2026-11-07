import { expect, it } from 'vitest'
import { INVALID_KEY } from '../env.js'
import { once, sleep } from '../wait.js'

/** What a test may change in how a provider connects */
export interface ConnectionOverrides {
  apiKey?: string
  connectionTimeout?: number
  retryDelay?: number
  maxRetry?: number
}

interface Provider {
  on(event: 'Failed', listener: (...args: any[]) => void): unknown
  once(event: 'Failed', listener: (...args: any[]) => void): unknown
  destroy(): void
  logger?: { log(...message: any[]): void }
}

/**
 * The edges of a connection every WebSocket provider goes through: a key the
 * provider refuses, a connection that never opens, a destroy while connecting
 * @param start - Gives the provider something to do, which opens the connection
 */
export function connectionScenarios<P extends Provider>(
  create: (overrides: ConnectionOverrides) => P,
  start: (provider: P) => void | Promise<void>,
  track: (provider: P) => void
) {
  it('gives up on a refused key, and says so once', async () => {
    const provider = create({ apiKey: INVALID_KEY, retryDelay: 200 })
    track(provider)
    let failures = 0
    provider.on('Failed', () => failures++)

    await start(provider)
    await once(provider, 'Failed', 45_000)
    await sleep(2000)

    expect(failures).toBe(1)
  })

  it('gives up on a connection that never opens', async () => {
    const provider = create({
      connectionTimeout: 1,
      retryDelay: 100,
      maxRetry: 2,
    })
    track(provider)

    const failed = once(provider, 'Failed', 10_000)
    await start(provider)
    await failed
  })

  it('never connects again once destroyed while connecting', async () => {
    const provider = create({})
    const logs: string[] = []
    provider.logger = { log: (...message) => logs.push(message.join(' ')) }
    await sleep(20)
    provider.destroy()
    const destroyedAt = logs.length
    await sleep(5000)

    const after = logs
      .slice(destroyedAt)
      .filter((line) => /Connection opened|Reconnecting/.test(line))
    expect(after).toEqual([])
  })
}

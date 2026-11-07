export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Waits for a condition, failing with a readable message past the timeout */
export async function waitFor(
  check: () => boolean,
  message: string,
  timeout = 30_000
): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeout) {
      throw new Error(`Timed out after ${timeout} ms waiting for ${message}`)
    }
    await sleep(50)
  }
}

/** Resolves with the arguments of the first time an event fires */
export function once<T extends unknown[]>(
  emitter: { once(event: string, listener: (...args: T) => void): unknown },
  event: string,
  timeout = 30_000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for ${event}`)),
      timeout
    )
    emitter.once(event, (...args: T) => {
      clearTimeout(timer)
      resolve(args)
    })
  })
}

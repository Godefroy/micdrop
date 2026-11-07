/** Anything a runtime hands back that has to be released once done with */
export interface Releasable {
  release(): Promise<void>
}

type SessionState<S> =
  | { status: 'unloaded' }
  | { status: 'loading'; promise: Promise<S> }
  | { status: 'loaded'; session: S }
  | { status: 'released' }

/**
 * An inference session created on first use, and released once.
 *
 * Every caller asking while it loads shares the same load, so two of them
 * never create two sessions and leak one. A release during the load disposes
 * of the session as soon as it arrives instead of letting it come back to life,
 * and waits for the runs in flight before freeing the runtime under them. A
 * failed load is forgotten, so the next call tries again.
 *
 * Shared by the Silero models of `@micdrop/web` and `@micdrop/react-native`.
 * `@micdrop/smart-turn` holds the same few lines for its own models, as it
 * depends on no other package.
 */
export class LazySession<S extends Releasable> {
  private state: SessionState<S> = { status: 'unloaded' }
  private runs = new Set<Promise<unknown>>()

  /**
   * @param name - What the session runs, to name it in errors
   * @param create - Creates the session, called once unless it fails
   */
  constructor(
    private name: string,
    private create: () => Promise<S>
  ) {}

  get status(): SessionState<S>['status'] {
    return this.state.status
  }

  /** The session, loaded on the first call */
  get(): Promise<S> {
    const state = this.state
    if (state.status === 'loaded') return Promise.resolve(state.session)
    if (state.status === 'loading') return state.promise
    if (state.status === 'released') return Promise.reject(this.releasedError())

    const promise: Promise<S> = this.create().then(
      async (session) => {
        if (this.isLoading(promise)) {
          this.state = { status: 'loaded', session }
          return session
        }
        // Released while it loaded, and nobody else holds it to release it
        await session.release()
        throw this.releasedError()
      },
      (error) => {
        if (this.isLoading(promise)) this.state = { status: 'unloaded' }
        throw error
      }
    )
    this.state = { status: 'loading', promise }
    return promise
  }

  /**
   * Runs something on the session, which a release waits for
   * @param run - Uses the session, and only until its promise settles
   */
  async use<T>(run: (session: S) => Promise<T>): Promise<T> {
    const session = await this.get()
    // Released between the load and this turn
    if (this.state.status !== 'loaded' || this.state.session !== session) {
      throw this.releasedError()
    }
    const pending = run(session)
    this.runs.add(pending)
    try {
      return await pending
    } finally {
      this.runs.delete(pending)
    }
  }

  /** Releases the session, for good */
  async release(): Promise<void> {
    const state = this.state
    this.state = { status: 'released' }
    // A load in flight disposes of its own session when it lands
    if (state.status !== 'loaded') return
    await Promise.allSettled(this.runs)
    await state.session.release()
  }

  private isLoading(promise: Promise<S>): boolean {
    return this.state.status === 'loading' && this.state.promise === promise
  }

  private releasedError(): Error {
    return new Error(`The ${this.name} model was released`)
  }
}

/**
 * Fetches each address once for as long as the app runs, however many models
 * ask for it. A failed download is forgotten, so a later call tries again.
 */
export function createDownloadCache<T>(
  download: (url: string) => Promise<T>
): (url: string) => Promise<T> {
  const downloads = new Map<string, Promise<T>>()
  return (url) => {
    let pending = downloads.get(url)
    if (!pending) {
      const started = download(url)
      downloads.set(url, started)
      started.catch(() => {
        if (downloads.get(url) === started) downloads.delete(url)
      })
      pending = started
    }
    return pending
  }
}

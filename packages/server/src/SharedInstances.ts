/**
 * Keeps one loaded instance per configuration, shared by every call.
 *
 * A local model costs from a few hundred milliseconds to a minute to load, and
 * holding a second copy of the same weights wastes the memory the rest of the
 * pipeline needs. Inference is bound to a few threads anyway, so two calls
 * generating at once compete for the same cores whether they share the
 * instance or not.
 *
 * Instances are keyed by the options they were built from, so changing a model
 * or a device loads that one and leaves the others alone. They stay loaded for
 * the lifetime of the process, or for `ttl` milliseconds when it is set, which
 * suits a list fetched from an API that changes now and then.
 *
 * ```typescript
 * const synthesizers = new SharedInstances<Synthesizer>()
 *
 * function loadSynthesizer(options: Options) {
 *   return synthesizers.load([options.model, options.device], () =>
 *     Synthesizer.from_pretrained(options.model, { device: options.device })
 *   )
 * }
 * ```
 */
export interface SharedInstancesOptions {
  /** How long an instance is kept once loaded, in ms. Forever by default. */
  ttl?: number
}

export class SharedInstances<T> {
  private entries = new Map<string, Promise<T>>()
  // When each instance expires, for the ones that do
  private expiries = new Map<string, number>()

  constructor(private readonly options: SharedInstancesOptions = {}) {}

  /**
   * Returns the instance for this key, calling `create` the first time.
   *
   * The key can be any JSON-serializable value, usually an array of the
   * options that define the instance. Concurrent callers get the same promise
   * instead of loading the model twice.
   */
  load(key: unknown, create: () => Promise<T>): Promise<T> {
    const id = typeof key === 'string' ? key : JSON.stringify(key)
    this.expire(id)
    const existing = this.entries.get(id)
    if (existing) return existing

    let loading: Promise<T>
    try {
      loading = create()
    } catch (error) {
      // Report a synchronous throw as a rejection, without keeping an entry
      return Promise.reject(error)
    }

    // A failed download must not poison the cache, the next call retries it
    loading.catch(() => {
      if (this.entries.get(id) === loading) this.entries.delete(id)
    })

    this.entries.set(id, loading)
    const { ttl } = this.options
    if (ttl !== undefined) {
      // Counted from the end of the load, not its start
      loading.then(
        () => {
          if (this.entries.get(id) === loading) {
            this.expiries.set(id, Date.now() + ttl)
          }
        },
        () => {}
      )
    }
    return loading
  }

  /** Forgets an instance whose time is up */
  private expire(id: string) {
    const expiry = this.expiries.get(id)
    if (expiry === undefined || Date.now() < expiry) return
    this.entries.delete(id)
    this.expiries.delete(id)
  }

  /** The instance for this key, loaded or being loaded, without loading it. */
  get(key: unknown): Promise<T> | undefined {
    const id = typeof key === 'string' ? key : JSON.stringify(key)
    this.expire(id)
    return this.entries.get(id)
  }

  /** Whether an instance is loaded, or being loaded, for this key. */
  has(key: unknown): boolean {
    const id = typeof key === 'string' ? key : JSON.stringify(key)
    this.expire(id)
    return this.entries.has(id)
  }

  /**
   * Forgets the instance for this key, so the next call loads a new one. For
   * an instance that broke, a crashed worker for instance. Releasing what it
   * holds is left to the caller.
   */
  delete(key: unknown): void {
    const id = typeof key === 'string' ? key : JSON.stringify(key)
    this.entries.delete(id)
    this.expiries.delete(id)
  }

  /** Drops every instance, so the next call loads again. */
  clear(): void {
    this.entries.clear()
    this.expiries.clear()
  }
}

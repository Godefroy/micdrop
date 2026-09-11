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
 * the lifetime of the process.
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
export class SharedInstances<T> {
  private entries = new Map<string, Promise<T>>()

  /**
   * Returns the instance for this key, calling `create` the first time.
   *
   * The key can be any JSON-serializable value, usually an array of the
   * options that define the instance. Concurrent callers get the same promise
   * instead of loading the model twice.
   */
  load(key: unknown, create: () => Promise<T>): Promise<T> {
    const id = typeof key === 'string' ? key : JSON.stringify(key)
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
    return loading
  }

  /** Whether an instance is loaded, or being loaded, for this key. */
  has(key: unknown): boolean {
    return this.entries.has(typeof key === 'string' ? key : JSON.stringify(key))
  }

  /** Drops every instance, so the next call loads again. */
  clear(): void {
    this.entries.clear()
  }
}

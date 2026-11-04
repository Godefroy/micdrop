/** How long after the assistant starts a voice over it is taken for its echo */
export const ECHO_WATCH = 2000 // ms

/**
 * How far a call has gone to keep the assistant out of the microphone.
 *
 * - `normal`: the speaker plays as usual
 * - `fallback`: it plays by the other route the platform offers
 * - `disabled`: the user may no longer interrupt, until the call ends
 */
export type EchoStage = 'normal' | 'fallback' | 'disabled'

/**
 * Tells the echo of the assistant from someone speaking over it.
 *
 * A browser can report echo cancellation on while the microphone still hears
 * the speaker, and nothing says so but the assistant cutting itself off. Very
 * few people speak over a voice that has only just started, so speech heard
 * that early is treated as echo. A person doing so loses a word at worst.
 */
export class EchoGuard {
  public stage: EchoStage = 'normal'

  // The next sound opens a watch, the first of a call or after a new route
  private isDue = true
  private watchEnd: number | undefined

  /** @param now - The current time, in milliseconds */
  speakerStarted(now: number) {
    if (!this.isDue) return
    this.isDue = false
    this.watchEnd = now + ECHO_WATCH
  }

  /** @param now - The current time, in milliseconds */
  speakerStopped(now: number) {
    if (this.watchEnd === undefined) return
    // A new route has not been heard for long enough to be trusted yet
    if (this.stage === 'fallback' && now < this.watchEnd) {
      this.isDue = true
    }
    this.watchEnd = undefined
  }

  /**
   * Moves to the next stage if the speech heard can only be echo
   * @param now - The current time, in milliseconds
   * @returns True if the speech is to be ignored
   */
  speechHeard(now: number): boolean {
    if (this.watchEnd === undefined || now >= this.watchEnd) return false
    if (this.stage === 'normal') {
      this.stage = 'fallback'
      this.watchEnd = now + ECHO_WATCH
    } else {
      this.stage = 'disabled'
      this.watchEnd = undefined
    }
    return true
  }

  reset() {
    this.stage = 'normal'
    this.isDue = true
    this.watchEnd = undefined
  }
}

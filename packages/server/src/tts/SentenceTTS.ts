import { Readable } from 'stream'
import { SentenceSplitter } from './SentenceSplitter'
import { TTS } from './TTS'

/**
 * Base class for text to speech engines that read a whole input at once.
 *
 * A local model, and a remote endpoint without a streaming interface, cannot
 * be fed the agent's answer token by token. This class buffers the answer into
 * sentences, hands them over one at a time, and emits the audio in the order
 * they were written. Subclasses only have to turn one sentence into PCM16 at
 * the rate the Micdrop client expects.
 *
 * Sentences are synthesized one after the other rather than at once: a local
 * model is single threaded, so racing two sentences through it slows both down
 * without bringing the first word any closer.
 */
export abstract class SentenceTTS extends TTS {
  private splitter = new SentenceSplitter()
  private queue: string[] = []
  private draining = false
  private controller?: AbortController
  // Bumped by every speak() and every cancel(), so a call claimed late can tell
  // whether it is still the one that should be heard.
  private generation = 0
  private counter = 0 // Identifies the current speak() call
  private synthesizing = 0 // Stamp of the sentence being synthesized

  /**
   * Turns one sentence into PCM16 audio at the client's sample rate.
   *
   * The signal is aborted when the utterance is cancelled, which is the moment
   * to stop a subprocess or an inference that is no longer needed. Returning
   * nothing emits nothing, which is how a cancelled synthesis reports back.
   */
  protected abstract synthesize(
    text: string,
    signal: AbortSignal
  ): Promise<Buffer | undefined>

  /**
   * Emits a piece of the sentence being synthesized.
   *
   * A model that generates progressively can hand its chunks over as they
   * come rather than waiting for the sentence to be finished, which brings
   * the first word forward by the duration of that sentence. The false it
   * returns says the utterance was cancelled or replaced, so the generation
   * it comes from can be stopped there.
   */
  protected emitAudio(audio: Buffer): boolean {
    if (this.synthesizing !== this.counter) return false
    if (audio.length) this.emit('Audio', audio)
    return true
  }

  speak(textStream: Readable) {
    const generation = ++this.generation
    let counter = 0

    // Claiming the call is deferred until there is something to say.
    //
    // Taking the next number right away would drop the utterance still being
    // spoken, since the queue skips anything stamped with an older one. A
    // stream that never carries a word, which is what an answer skipped by a
    // tool or by onBeforeAnswer hands over, would then cut the assistant off
    // and throw away the sentences still queued.
    const claimCall = () => {
      if (counter) return true
      // Cancelled, or superseded by another speak(), before the first word
      if (this.generation !== generation) return false
      this.counter++
      counter = this.counter
      this.splitter.reset()
      // The utterance it takes over from is not heard any further: neither
      // the sentences it left in the queue, nor the one being synthesized
      this.queue = []
      this.controller?.abort()
      this.controller = undefined
      return true
    }

    textStream.on('data', (chunk: Buffer) => {
      if (!claimCall()) return
      if (counter !== this.counter) return
      this.enqueue(counter, this.splitter.push(chunk.toString('utf-8')))
    })

    textStream.on('error', (error) => {
      this.log('Error in text stream', error)
    })

    textStream.on('end', () => {
      // Nothing was ever said, so there is nothing left to flush
      if (!counter || counter !== this.counter) return
      this.enqueue(counter, this.splitter.flush())
    })
  }

  cancel() {
    this.log('Cancel')
    this.generation++
    // Increment counter to ignore queued work and the sentence in flight
    this.counter++
    this.splitter.reset()
    this.queue = []
    this.controller?.abort()
    this.controller = undefined
  }

  private enqueue(counter: number, sentences: string[]) {
    if (sentences.length === 0) return
    if (counter !== this.counter) return
    this.queue.push(...sentences)
    this.drain()
  }

  private async drain() {
    if (this.draining) return
    this.draining = true

    while (this.queue.length > 0) {
      const counter = this.counter
      this.synthesizing = counter
      const text = this.queue.shift()!
      const controller = new AbortController()
      this.controller = controller

      try {
        this.log(`Synthesizing: "${text}"`)
        const audio = await this.synthesize(text, controller.signal)
        // The utterance may have been cancelled while it was being synthesized
        if (counter !== this.counter) continue
        if (audio?.length) this.emit('Audio', audio)
      } catch (error) {
        // A cancelled utterance is not a failure, it left its queue on purpose
        if (counter !== this.counter) continue
        this.log('Error synthesizing speech', error)
        this.emit('Failed', [text, ...this.queue])
        this.queue = []
      } finally {
        if (this.controller === controller) this.controller = undefined
      }
    }

    this.draining = false
    // Sentences may have arrived right as we exited the loop
    if (this.queue.length > 0) this.drain()
  }
}

import { EventEmitter } from 'eventemitter3'
import { Logger } from '../Logger'
import { MicdropClassification } from '../types'

/** What a classifier reads: a text, or JSON with named fields */
export type ClassifierInput = string | { [key: string]: any } | any[]

export interface ClassifierEvents<Result, Input> {
  Classification: [MicdropClassification<Result, Input>]
}

/**
 * Turns an input into typed decisions: intent, mood, risk. It answers
 * questions about what the user said, where an agent answers the user.
 *
 * `MicdropServer` classifies each turn of the user when it ends, with a
 * `MicdropTurnInput`, and a classifier works on its own just as well: call
 * `classify()` with any text or JSON.
 *
 * This class keeps track of the classifications in progress, to wait for them
 * or cancel them. A provider implements `evaluate()`.
 */
export abstract class Classifier<
  Result = any,
  Input extends ClassifierInput = ClassifierInput,
> extends EventEmitter<ClassifierEvents<Result, Input>> {
  public logger?: Logger

  /** The last classification */
  public lastClassification?: MicdropClassification<Result, Input>

  private controllers = new Set<AbortController>()
  private _pending?: Promise<MicdropClassification<Result, Input> | undefined>

  /**
   * Answers the questions of this classifier about an input
   * @param input - What to classify
   * @param signal - Aborted once the result is no longer wanted
   */
  protected abstract evaluate(
    input: Input,
    signal: AbortSignal
  ): Promise<Result>

  /**
   * Classifies an input, and emits the result as `Classification`
   * @param input - What to classify: a text, or JSON with named fields
   * @returns The classification, or undefined when cancelled or failed
   */
  classify(
    input: Input
  ): Promise<MicdropClassification<Result, Input> | undefined> {
    const controller = new AbortController()
    this.controllers.add(controller)
    const pending = this.run(input, controller.signal).finally(() => {
      this.controllers.delete(controller)
      if (this._pending === pending) this._pending = undefined
    })
    this._pending = pending
    return pending
  }

  /** The last classification started, until it is done */
  get pending() {
    return this._pending
  }

  /** Drops every classification in progress, which then emit nothing */
  cancel() {
    this.controllers.forEach((controller) => controller.abort())
    this.controllers.clear()
    this._pending = undefined
  }

  protected log(...message: any[]) {
    this.logger?.log(...message)
  }

  destroy() {
    this.log('Destroyed')
    this.cancel()
    this.removeAllListeners()
  }

  private async run(
    input: Input,
    signal: AbortSignal
  ): Promise<MicdropClassification<Result, Input> | undefined> {
    const start = Date.now()
    try {
      const result = await this.evaluate(input, signal)
      if (signal.aborted) return

      const classification: MicdropClassification<Result, Input> = {
        input,
        result,
        duration: Date.now() - start,
      }
      this.log(
        `Classified in ${classification.duration} ms:`,
        JSON.stringify(input)
      )
      this.lastClassification = classification
      this.emit('Classification', classification)
      return classification
    } catch (error) {
      if (!signal.aborted) this.log('Classification failed:', error)
      return
    }
  }
}

/** What `MicdropServer` classifies at the end of each turn of the user */
export interface MicdropTurnInput {
  /**
   * The turn before, and the answer that followed it, so words like "it" or
   * "there" can be understood
   */
  history: Array<{ role: 'user' | 'assistant'; text: string }>
  /** What the user said in this turn, one or more transcripts joined */
  turn: string
}

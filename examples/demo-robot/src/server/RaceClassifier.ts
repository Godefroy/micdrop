import { Classifier, ClassifierInput } from '@micdrop/server'
import type { Brain } from '../shared/commands'

/**
 * Two classifiers on the same turn, started at the same moment. Each answer
 * goes to the client as soon as it lands, tagged with the brain that gave it,
 * so the browser plays each one on its own robot.
 */
export class RaceClassifier extends Classifier<{ brain: Brain }> {
  constructor(private brains: Record<Brain, Classifier>) {
    super()
  }

  protected async evaluate(input: ClassifierInput, signal: AbortSignal) {
    const entries = Object.entries(this.brains) as Array<[Brain, Classifier]>
    signal.addEventListener('abort', () =>
      entries.forEach(([, classifier]) => classifier.cancel())
    )

    // The first answer is returned, and emitted by the base class. The
    // others are emitted here as they land
    return new Promise<{ brain: Brain }>((resolve, reject) => {
      let settled = 0
      let first = true
      for (const [brain, classifier] of entries) {
        classifier.classify(input).then((classification) => {
          settled++
          if (classification && !signal.aborted) {
            const result = { ...classification.result, brain }
            if (first) {
              first = false
              resolve(result)
            } else {
              this.emit('Classification', { ...classification, result })
            }
          }
          if (settled === entries.length && first) {
            reject(new Error('Every brain failed'))
          }
        })
      }
    })
  }
}

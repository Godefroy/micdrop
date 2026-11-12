import type { Classifier, MicdropTurnInput } from '@micdrop/server'
import { afterEach, describe, expect, it } from 'vitest'
import { hasKeys, INVALID_KEY } from '../env.js'
import { captureLogs } from '../logs.js'
import { sleep } from '../wait.js'

/**
 * The questions every classifier is asked, written once. Each provider builds
 * them with its own helpers, and reads its answers back in `ReadAnswers`.
 */
export const QUESTIONS = {
  intent: {
    instructions:
      'What does the user in `turn` want? Read `history` for context.',
    choices: {
      billing: 'A charge, an invoice, a refund',
      outage: 'The service is down or slow',
      cancel: 'Cancel the subscription or switch provider',
      other: 'Anything else',
    },
  },
  frustration: {
    instructions: 'How frustrated is the user in `turn`?',
    levels: ['Calm', 'Annoyed', 'Angry'],
  },
  wantsHuman: {
    instructions: 'Does the user in `turn` ask to speak to a human?',
  },
} as const

/** The answers of a provider, in a shape shared by all of them */
export interface ReadAnswers {
  intent?: string
  /** From 0 (calm) to 2 (angry) */
  frustration?: number
  /** Probability, from 0 to 1 */
  wantsHuman?: number
}

export interface ClassifierScenarioOptions<C extends Classifier> {
  /** Keys the provider needs, the scenarios are skipped without them */
  keys: string[]
  /** Builds the classifier with `QUESTIONS` */
  create(overrides: { apiKey?: string }): C
  read(result: any): ReadAnswers
}

const turn = (text: string, history: MicdropTurnInput['history'] = []) => ({
  history,
  turn: text,
})

/** What every classifier has to do in a call */
export function describeClassifier<C extends Classifier>(
  name: string,
  options: ClassifierScenarioOptions<C>
) {
  describe.skipIf(!hasKeys(...options.keys))(name, () => {
    const instances: C[] = []
    const create = (overrides: { apiKey?: string } = {}) => {
      const classifier = captureLogs(options.create(overrides), name)
      instances.push(classifier)
      return classifier
    }
    afterEach(() => instances.splice(0).forEach((c) => c.destroy()))

    it('classifies a turn and emits it', async () => {
      const classifier = create()
      const emitted: unknown[] = []
      classifier.on('Classification', (c) => emitted.push(c))
      const input = turn(
        'Hi, I was charged twice on my last invoice, could you check?'
      )

      const classification = await classifier.classify(input)

      expect(classification).toBeDefined()
      expect(classification!.input).toEqual(input)
      expect(classification!.duration).toBeGreaterThan(0)
      expect(emitted).toEqual([classification])
      expect(classifier.lastClassification).toBe(classification)

      const answers = options.read(classification!.result)
      expect(answers.intent).toBe('billing')
      expect(answers.wantsHuman).toBeLessThan(0.5)
      expect(answers.frustration).toBeLessThan(1.5)
    })

    it('reads the history to understand the turn', async () => {
      const classifier = create()

      const classification = await classifier.classify(
        turn('Yes, do it.', [
          { role: 'user', text: 'I want to stop my subscription.' },
          {
            role: 'assistant',
            text: 'Do you confirm that you want to cancel your subscription?',
          },
        ])
      )

      expect(options.read(classification!.result).intent).toBe('cancel')
    })

    it('hears an angry ask for a human', async () => {
      const classifier = create()

      const classification = await classifier.classify(
        turn(
          'This is the third outage this week! Put me through to a real person, now!'
        )
      )

      const answers = options.read(classification!.result)
      expect(answers.wantsHuman).toBeGreaterThan(0.5)
      expect(answers.frustration).toBeGreaterThan(1)
    })

    it('classifies a plain text', async () => {
      const classifier = create()

      const classification = await classifier.classify(
        'My internet has been down since this morning.'
      )

      expect(options.read(classification!.result).intent).toBe('outage')
    })

    it('resolves to nothing on a refused key, and logs why', async () => {
      const classifier = create({ apiKey: INVALID_KEY })
      const logs: string[] = []
      classifier.logger = {
        log: (...m: any[]) => logs.push(m.join(' ')),
      } as any
      let emitted = 0
      classifier.on('Classification', () => emitted++)

      const classification = await classifier.classify(turn('Hello'))

      expect(classification).toBeUndefined()
      expect(emitted).toBe(0)
      expect(logs.some((line) => line.includes('Classification failed'))).toBe(
        true
      )
    })

    it('emits nothing once cancelled', async () => {
      const classifier = create()
      let emitted = 0
      classifier.on('Classification', () => emitted++)

      const pending = classifier.classify(turn('My internet is down.'))
      classifier.cancel()
      const classification = await pending
      // A response arriving late is dropped too
      await sleep(3000)

      expect(classification).toBeUndefined()
      expect(emitted).toBe(0)
      expect(classifier.lastClassification).toBeUndefined()
    })
  })
}

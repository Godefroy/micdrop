import type { MicdropClassification } from '@micdrop/server'
import type { Mode } from '../shared/modes'
import { MAX_QUESTIONS, Reply, toVerdict } from '../shared/replies'
import { JevResult } from './questions'
import { Secret, SECRETS } from './secrets'

/** What the game says, as a thing it thinks of or as the person it plays */
const TEXTS = {
  thing: {
    opening: `I'm thinking of something. Find it with yes or no questions, you have ${MAX_QUESTIONS}.`,
    reveal: (name: string) => `It was ${name}.`,
  },
  person: {
    opening: `I'm a famous person, real or fictional. Find who I am with yes or no questions, you have ${MAX_QUESTIONS}.`,
    reveal: (name: string) => `I'm ${name}.`,
  },
}

export function opening(mode: Mode) {
  return TEXTS[mode].opening
}

/** Above this, the user found the secret */
const CORRECT = 0.6

/** A game of twenty questions, with its secret, on the server */
export class Game {
  secret: Secret
  private count = 0
  private hints = 0
  private over = false

  constructor(
    readonly mode: Mode,
    previous?: Secret
  ) {
    const choices = SECRETS[mode].filter((secret) => secret !== previous)
    this.secret = choices[Math.floor(Math.random() * choices.length)]
  }

  /** The opening line, and its reply */
  start(): [string, Reply] {
    return [opening(this.mode), { type: 'start' }]
  }

  /**
   * What the game says back to a turn read by Jev: its messages, each with
   * its reply. None when the turn was not meant for the game.
   */
  play({
    input,
    result,
    duration,
  }: MicdropClassification<JevResult>): [string, Reply][] {
    const { answers } = result
    const intent = answers.intent.choice
    const question: string = input.turn

    if (this.over) {
      return intent === 'other'
        ? []
        : [
            [
              'This game is over. Say "new game" to play again.',
              { type: 'note' },
            ],
          ]
    }

    switch (intent) {
      case 'question': {
        this.count++
        if (answers.correct.noul >= CORRECT) {
          this.over = true
          return [
            [
              `Yes! ${TEXTS[this.mode].reveal(this.secret.name)} Found in ${this.count} question${this.count > 1 ? 's' : ''}.`,
              {
                type: 'won',
                question,
                secret: this.secret.name,
                count: this.count,
              },
            ],
          ]
        }
        const probability = answers.answer.noul
        const { verdict, text } = toVerdict(probability)
        const reply: Reply = {
          type: 'answer',
          question,
          probability,
          verdict,
          count: this.count,
          duration,
        }
        if (this.count < MAX_QUESTIONS) return [[text, reply]]
        this.over = true
        return [
          [text, reply],
          [
            `That was question ${MAX_QUESTIONS}. ${TEXTS[this.mode].reveal(this.secret.name)}`,
            {
              type: 'lost',
              secret: this.secret.name,
              reason: 'out_of_questions',
            },
          ],
        ]
      }
      case 'open':
        return [
          ['Ask me a question I can answer with yes or no.', { type: 'note' }],
        ]
      case 'hint':
        return [this.hint()]
      case 'give_up':
        this.over = true
        return [
          [
            TEXTS[this.mode].reveal(this.secret.name),
            { type: 'lost', secret: this.secret.name, reason: 'give_up' },
          ],
        ]
      default:
        return []
    }
  }

  /** The hints of the secret, one after the other, the last one again */
  private hint(): [string, Reply] {
    const { hints } = this.secret
    const hint = hints[Math.min(this.hints, hints.length - 1)]
    this.hints++
    return [hint, { type: 'hint', hint }]
  }
}

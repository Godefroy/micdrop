/** How many questions the user has to find the secret */
export const MAX_QUESTIONS = 20

/**
 * The answers to a yes or no question, from the probability of a yes that
 * Jev gives. The middle of the scale is where the question is ambiguous for
 * this thing, or its answer depends on the case.
 */
export const VERDICTS = [
  { verdict: 'yes', min: 0.85, text: 'Yes.' },
  { verdict: 'probably', min: 0.65, text: 'Probably.' },
  { verdict: 'unknown', min: 0.35, text: 'I don’t know, it depends.' },
  { verdict: 'probably_not', min: 0.15, text: 'Probably not.' },
  { verdict: 'no', min: 0, text: 'No.' },
] as const

export type Verdict = (typeof VERDICTS)[number]['verdict']

export function toVerdict(probability: number) {
  return VERDICTS.find(({ min }) => probability >= min) ?? VERDICTS[4]
}

/**
 * What the server says back, in the metadata of each of its messages. The
 * secret stays on the server until the game ends.
 */
export type Reply =
  | { type: 'start' }
  | {
      type: 'answer'
      question: string
      /** Probability of a yes, from Jev */
      probability: number
      verdict: Verdict
      /** Questions asked so far, this one included */
      count: number
      duration: number
    }
  | { type: 'won'; question: string; secret: string; count: number }
  | { type: 'lost'; secret: string; reason: 'give_up' | 'out_of_questions' }
  | { type: 'hint'; hint: string }
  /** Anything that is not a question for the game, and why */
  | { type: 'note' }
  /** A turn Jev did not read as meant for the game */
  | { type: 'ignored'; question: string }

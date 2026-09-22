import type { MicdropTurnInput } from '@micdrop/server'
import type { Mode } from '../shared/modes'
import {
  choice,
  noul,
  type ChoiceResponse,
  type NoulResponse,
  type SystemOneResult,
} from '@micdrop/typesafe'

/** What the user does in a turn */
const INTENTS = {
  question:
    'Asks a question that can be answered by yes or no, about the secret or naming a guess: "is it an animal?", "are you a woman?", "is it a banana?"',
  open: 'Asks a question that cannot be answered by yes or no: "what color is it?"',
  hint: 'Asks for a hint or a clue',
  give_up: 'Gives up, asks what the secret was',
  new_game: 'Asks for a new game, another secret to find',
  other: 'Anything else: thinking aloud, chatting',
} as const

export type Intent = keyof typeof INTENTS

/**
 * Everything Jev is asked about a turn, in a single request. `answer` is the
 * game itself: the probability of a yes is the answer, and "I don't know"
 * when Jev hesitates. The questions are speculative: `answer` and `correct`
 * are read only when the turn is a question.
 */
export const QUESTIONS = {
  intent: choice(
    'What does the user playing twenty questions do in `turn`? Read `history` for context.',
    INTENTS
  ),
  answer: noul(
    'The user asks a yes or no question about `secret`, what they have to find, as `game` describes it. Read `history` to know what words like it or that stand for. Is the true answer to the question in `turn` yes?'
  ),
  correct: noul(
    'Does the user in `turn` name `secret` itself, or a close synonym of it, rather than only a category it belongs to?'
  ),
}

/** How the game plays, for Jev to read the questions right */
const GAMES: Record<Mode, string> = {
  thing:
    'Twenty questions: the game thinks of `secret`, a thing, and the user asks about it.',
  person:
    'Who am I: the game plays `secret`, a famous person or character, and the user asks it questions. "You" in a question means `secret`.',
}

/** What Jev reads: the turn, the one before with its answer, and the secret */
export function buildState(
  input: MicdropTurnInput,
  secret: string,
  mode: Mode
) {
  return { ...input, game: GAMES[mode], secret }
}

type Answers = {
  intent: ChoiceResponse<typeof INTENTS>
  answer: NoulResponse
  correct: NoulResponse
}

export type JevResult = SystemOneResult<typeof QUESTIONS> & {
  answers: Answers
}

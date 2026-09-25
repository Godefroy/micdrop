import { Classifier } from '@micdrop/server'
import { TypesafeClassifier } from '@micdrop/typesafe'
import { Brain, QUESTIONS } from '../shared/commands'
import { ClaudeClassifier } from './ClaudeClassifier'
import { RaceClassifier } from './RaceClassifier'

/** A classifier for each brain, reading the same questions */
export const BRAINS: Record<Brain, () => Classifier> = {
  jev: () =>
    new TypesafeClassifier({
      apiKey: process.env.TYPESAFE_API_KEY || '',
      questions: QUESTIONS,
    }),
  claude: () =>
    new ClaudeClassifier({
      apiKey: process.env.ANTHROPIC_API_KEY || '',
      model: process.env.CLAUDE_MODEL,
      questions: QUESTIONS,
    }),
}

/**
 * Jev reads each turn. Two hidden modes, picked by the client in the URL:
 * `?brain=claude` asks Claude instead, and `?race` asks both at once, for two
 * robots side by side.
 */
export function brainFor(query: { brain?: string; race?: string }) {
  if (query.race !== undefined) {
    return new RaceClassifier({ jev: BRAINS.jev(), claude: BRAINS.claude() })
  }
  return BRAINS[query.brain === 'claude' ? 'claude' : 'jev']()
}

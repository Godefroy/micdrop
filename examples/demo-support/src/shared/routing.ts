import type { JevAnswers } from './questions'

/**
 * Who answers the turn, decided from the answers of Jev before the LLM writes
 * a single token.
 *
 * - `block`: a manipulation attempt never reaches the LLM
 * - `escalate`: a customer asking for a human, or angry, gets one
 * - `code`: a known outage is answered by code, instantly and for free
 * - `retain`: the LLM answers, told the customer might leave
 * - `llm`: the LLM answers
 *
 * Shared by the server, which acts on it, and the interface, which shows it.
 */
export type Route = 'block' | 'escalate' | 'code' | 'retain' | 'llm'

export function route(answers: JevAnswers): Route {
  if (answers.manipulation.noul > 0.7) return 'block'
  if (answers.wantsHuman.noul > 0.7 || answers.frustration.score > 2.5) {
    return 'escalate'
  }
  if (answers.intent.choice === 'outage' && answers.intent.confidence > 0.6) {
    return 'code'
  }
  if (answers.churn.noul > 0.6) return 'retain'
  return 'llm'
}

export const ROUTE_LABELS: Record<Route, string> = {
  block: 'Blocked before the LLM',
  escalate: 'Transferred to a human',
  code: 'Answered by code, no LLM',
  retain: 'LLM, with a retention offer',
  llm: 'LLM',
}

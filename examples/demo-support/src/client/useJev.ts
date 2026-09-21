import { useMicdropClassification } from '@micdrop/react'
import { MicdropClassification } from '@micdrop/web'
import { useCallback, useState } from 'react'
import { JevResult } from '../shared/questions'

/** Jev bills input tokens only, $42 per billion */
const PRICE_PER_TOKEN = 42 / 1e9

export interface JevStats {
  requests: number
  tokens: number
  cost: number
  lastDuration?: number
}

export interface JevState {
  /** The latest classification */
  last?: MicdropClassification<JevResult>
  /** Classifications, by the turn they read */
  byTranscript: Record<string, MicdropClassification<JevResult>>
  stats: JevStats
}

/** Collects what Jev sends, for the panel and the turn badges */
export function useJev(): JevState {
  const [state, setState] = useState<JevState>({
    byTranscript: {},
    stats: { requests: 0, tokens: 0, cost: 0 },
  })

  const handleClassification = useCallback(
    (classification: MicdropClassification<JevResult>) => {
      setState((previous) => {
        const tokens = classification.result.usage.input_tokens
        return {
          last: classification,
          byTranscript: {
            ...previous.byTranscript,
            [classification.input.turn]: classification,
          },
          stats: {
            requests: previous.stats.requests + 1,
            tokens: previous.stats.tokens + tokens,
            cost: previous.stats.cost + tokens * PRICE_PER_TOKEN,
            lastDuration: classification.duration,
          },
        }
      })
    },
    []
  )
  useMicdropClassification(handleClassification)

  return state
}

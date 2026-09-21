import { useMicdropClassification, useMicdropToolCall } from '@micdrop/react'
import {
  Micdrop,
  MicdropClassification,
  MicdropConversationItem,
  MicdropToolCall,
} from '@micdrop/web'
import { useCallback, useEffect, useRef, useState } from 'react'
import { isEmpty, JevResult, plan, Plan } from '../shared/plan'
import { DeckUpdate, Slide, TOOL_UPDATE_SLIDES } from '../shared/slides'

export interface DeckState {
  slides: Slide[]
  /** What Jev read in the turn, laid out until the LLM fills it */
  pending?: Plan
  /** The last classification, and the plan it gave */
  last?: { classification: MicdropClassification<JevResult>; plan: Plan }
}

/**
 * The deck comes from the tool of the agent, the placeholders from Jev: they
 * show up a few hundred ms after the transcript, and the content seconds
 * later, when the LLM has written it.
 */
export function useDeck(): DeckState {
  const [state, setState] = useState<DeckState>({ slides: [] })
  const slides = useRef(state.slides)
  slides.current = state.slides

  const handleClassification = useCallback(
    (classification: MicdropClassification<JevResult>) => {
      const next = plan(classification.result, slides.current)
      setState((previous) => ({
        ...previous,
        pending: isEmpty(next) ? undefined : next,
        last: { classification, plan: next },
      }))
    },
    []
  )
  useMicdropClassification(handleClassification)

  const handleToolCall = useCallback((toolCall: MicdropToolCall) => {
    if (toolCall.name !== TOOL_UPDATE_SLIDES) return
    const update = toolCall.output as DeckUpdate
    setState((previous) => ({
      ...previous,
      slides: update.slides,
      pending: undefined,
    }))
  }, [])
  useMicdropToolCall(handleToolCall)

  // An answer without any change to the deck leaves nothing to wait for
  useEffect(() => {
    const handleMessage = (message: MicdropConversationItem) => {
      if (message.role !== 'assistant') return
      setState((previous) => ({ ...previous, pending: undefined }))
    }
    Micdrop.on('Message', handleMessage)
    return () => {
      Micdrop.off('Message', handleMessage)
    }
  }, [])

  return state
}

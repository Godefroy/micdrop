import { currentTurn, MicdropConversation, MicdropState } from '@micdrop/web'
import { useEffect, useRef } from 'react'
import { route, ROUTE_LABELS } from '../../shared/routing'
import { JevState } from '../useJev'

interface Props {
  state: MicdropState
  jev: JevState
}

/**
 * The call as it goes. A turn of the customer can hold several transcripts,
 * and its last one carries the route Jev picked for the whole turn.
 */
export default function Conversation({ state, jev }: Props) {
  const bottom = useRef<HTMLDivElement>(null)
  const { conversation } = state

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversation.length, jev.last])

  return (
    <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
      {!state.isStarted && conversation.length === 0 && (
        <p className="py-16 text-center text-slate-500">
          Call support, then speak as an unhappy customer.
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {conversation.map((item, index) => {
          if (item.role !== 'user' && item.role !== 'assistant') return null
          const isUser = item.role === 'user'
          const classification = isLastOfTurn(conversation, index)
            ? jev.byTranscript[
                currentTurn(conversation.slice(0, index + 1)).transcript
              ]
            : undefined

          return (
            <li
              key={index}
              className={`flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}
            >
              <p
                className={`max-w-[85%] rounded-2xl px-4 py-2 ${
                  isUser ? 'bg-sky-700' : 'bg-slate-800'
                }`}
              >
                {item.content}
              </p>
              {classification && (
                <span className="text-xs text-amber-300">
                  {ROUTE_LABELS[route(classification.result.answers)]}, decided
                  in {classification.duration} ms
                </span>
              )}
            </li>
          )
        })}
      </ul>
      <div ref={bottom} />
    </div>
  )
}

/** A user message that no other user message follows directly */
function isLastOfTurn(conversation: MicdropConversation, index: number) {
  return (
    conversation[index].role === 'user' &&
    conversation[index + 1]?.role !== 'user'
  )
}

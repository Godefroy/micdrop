import { describePlan, isEmpty } from '../shared/plan'
import { DeckState } from './useDeck'

/** What Jev read in the last turn, and how fast */
export default function JevBar({ deck }: { deck: DeckState }) {
  const { last } = deck
  if (!last) return null
  const { classification, plan } = last

  return (
    <div className="flex items-center gap-3 border-b border-slate-800 bg-slate-900/60 px-6 py-2 text-sm">
      <span className="rounded bg-amber-400/15 px-2 py-0.5 font-mono text-amber-300">
        Jev {classification.duration} ms
      </span>
      <span className="truncate text-slate-400">
        “{classification.input.turn}”
      </span>
      <span className="shrink-0 text-slate-500">→</span>
      <span className="shrink-0 text-slate-200">
        {isEmpty(plan)
          ? 'No change to the deck'
          : describePlan(plan, deck.slides)}
      </span>
    </div>
  )
}

import { Verdict } from '../shared/replies'

export const VERDICT_STYLES: Record<
  Verdict,
  { label: string; className: string }
> = {
  yes: { label: 'Yes', className: 'bg-emerald-500 text-emerald-950' },
  probably: { label: 'Probably', className: 'bg-lime-400 text-lime-950' },
  unknown: { label: 'I don’t know', className: 'bg-slate-400 text-slate-950' },
  probably_not: {
    label: 'Probably not',
    className: 'bg-orange-400 text-orange-950',
  },
  no: { label: 'No', className: 'bg-rose-500 text-rose-950' },
}

/** An answer, and the probability of a yes it comes from */
export default function VerdictChip({
  verdict,
  probability,
}: {
  verdict: Verdict
  probability: number
}) {
  const { label, className } = VERDICT_STYLES[verdict]
  return (
    <span className="flex shrink-0 items-center gap-3">
      <span className={`rounded-full px-3 py-1 text-sm font-bold ${className}`}>
        {label}
      </span>
      <span
        className="flex w-24 items-center gap-2 text-xs text-slate-400"
        title="Probability of a yes, from Jev"
      >
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
          <span
            className="block h-full rounded-full bg-emerald-400"
            style={{ width: `${Math.round(probability * 100)}%` }}
          />
        </span>
        {Math.round(probability * 100)}%
      </span>
    </span>
  )
}

import { Intent, INTENT_LABELS, QUESTIONS } from '../../shared/questions'
import { route, ROUTE_LABELS } from '../../shared/routing'
import { JevState } from '../useJev'

interface Props {
  jev: JevState
}

const SIGNALS = [
  { key: 'urgent', label: 'Urgent' },
  { key: 'churn', label: 'About to leave' },
  { key: 'wantsHuman', label: 'Wants a human' },
  { key: 'manipulation', label: 'Manipulation attempt' },
] as const

const INTENTS = Object.keys(QUESTIONS.intent.criteria) as Intent[]
const FRUSTRATION_LEVELS = QUESTIONS.frustration.criteria

/**
 * What Jev read in the last turn, when it ended: the
 * whole panel is one request, answered in a few hundred ms.
 */
export default function JevPanel({ jev }: Props) {
  const { last, stats } = jev
  const answers = last?.result.answers

  return (
    <aside className="flex min-h-0 flex-col gap-5 overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">What Jev read</h2>
        {last && (
          <span className="max-w-[60%] truncate text-xs text-slate-400">
            “{last.input.turn}”
          </span>
        )}
      </div>

      {!answers ? (
        <p className="text-sm text-slate-500">
          Its answers appear here as soon as the first sentence of the customer
          is transcribed.
        </p>
      ) : (
        <>
          <div className="rounded-xl bg-amber-500/10 px-3 py-2 text-sm">
            <span className="text-slate-400">Route </span>
            <span className="font-medium text-amber-300">
              {ROUTE_LABELS[route(answers)]}
            </span>
          </div>

          <section>
            <h3 className="mb-2 text-xs uppercase tracking-wide text-slate-500">
              Intent, {Math.round(answers.intent.confidence * 100)}% confident
            </h3>
            <ul className="flex flex-col gap-1">
              {INTENTS.map((intent) => {
                const probability = answers.intent.probabilities[intent]
                const chosen = answers.intent.choice === intent
                return (
                  <li key={intent} className="flex items-center gap-2 text-sm">
                    <span
                      className={`w-28 shrink-0 ${chosen ? 'text-white' : 'text-slate-400'}`}
                    >
                      {INTENT_LABELS[intent]}
                    </span>
                    <Bar value={probability} highlight={chosen} />
                  </li>
                )
              })}
            </ul>
          </section>

          <section>
            <h3 className="mb-2 text-xs uppercase tracking-wide text-slate-500">
              Frustration
            </h3>
            <Bar
              value={
                answers.frustration.score / (FRUSTRATION_LEVELS.length - 1)
              }
              highlight={answers.frustration.score > 1.5}
              tone="rose"
            />
            <p className="mt-1 text-sm text-slate-300">
              {FRUSTRATION_LEVELS[Math.round(answers.frustration.score)]}
            </p>
          </section>

          <section>
            <h3 className="mb-2 text-xs uppercase tracking-wide text-slate-500">
              Signals
            </h3>
            <ul className="flex flex-col gap-1">
              {SIGNALS.map(({ key, label }) => (
                <li key={key} className="flex items-center gap-2 text-sm">
                  <span className="w-40 shrink-0 text-slate-400">{label}</span>
                  <Bar
                    value={answers[key].noul}
                    highlight={answers[key].noul > 0.7}
                  />
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <dl className="mt-auto grid grid-cols-2 gap-2 border-t border-slate-800 pt-4 text-sm">
        <Stat
          label="Last request"
          value={stats.lastDuration ? `${stats.lastDuration} ms` : '–'}
        />
        <Stat label="Requests" value={String(stats.requests)} />
        <Stat label="Tokens read" value={stats.tokens.toLocaleString('en')} />
        <Stat label="Cost of the call" value={`$${stats.cost.toFixed(5)}`} />
      </dl>
    </aside>
  )
}

function Bar({
  value,
  highlight,
  tone = 'sky',
}: {
  value: number
  highlight: boolean
  tone?: 'sky' | 'rose'
}) {
  const color = highlight
    ? tone === 'rose'
      ? 'bg-rose-500'
      : 'bg-amber-400'
    : 'bg-sky-600'
  return (
    <span className="flex h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
      <span
        className={`h-full rounded-full transition-all duration-300 ${color}`}
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
      />
    </span>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-mono text-slate-200">{value}</dd>
    </div>
  )
}

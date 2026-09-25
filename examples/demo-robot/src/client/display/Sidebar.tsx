import { describeStep } from '../../shared/commands'
import type { Heard } from '../App'
import type { GameState } from '../game/Game'
import { Quest, QUESTS } from '../game/world'
import { BRAIN_NAME } from '../mode'

const SUGGESTIONS = [
  'Hello Bip!',
  'Go switch on the lamp, please',
  'Take the bucket and water the flower',
  'Bring the ball to the dog',
  'Give the banana to the dog',
  'Catch a fish and give it to the cat',
  'Cut down a tree',
  'Stop!',
]

/** The quests, what the model heard last, and a few things to say */
export default function Sidebar({
  state,
  heard,
}: {
  state: GameState
  heard?: Heard
}) {
  const quests = Object.keys(QUESTS) as Quest[]
  const done = quests.filter((quest) => state.quests[quest]).length

  return (
    <aside className="flex w-full shrink-0 flex-col gap-3 overflow-y-auto border-t border-white/10 lg:border-l lg:border-t-0 bg-[#0c1222] p-4 lg:w-80">
      <section className="rounded-2xl bg-white/[0.04] p-4">
        <h2 className="flex items-center justify-between font-semibold">
          Quests
          <span className="text-sm text-amber-300">
            {done}/{quests.length} ⭐
          </span>
        </h2>
        <div className="mb-3 mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber-300 to-orange-400 transition-all duration-700"
            style={{ width: `${(done / quests.length) * 100}%` }}
          />
        </div>
        <ul className="flex flex-col gap-1.5 text-sm">
          {quests.map((quest) => {
            const complete = state.quests[quest]
            return (
              <li
                key={quest}
                className={`flex items-center gap-2 ${complete ? 'text-emerald-300' : 'text-slate-200'}`}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${
                    complete
                      ? 'bg-emerald-400 text-emerald-950'
                      : 'border border-white/25'
                  }`}
                >
                  {complete && '✓'}
                </span>
                <span className={complete ? 'line-through opacity-70' : ''}>
                  {QUESTS[quest]}
                </span>
              </li>
            )
          })}
        </ul>
      </section>

      <section className="rounded-2xl bg-white/[0.04] p-4">
        <h2 className="mb-2 font-semibold">What {BRAIN_NAME} heard</h2>
        {heard ? (
          <>
            <p className="text-sm italic text-slate-200">
              “{heard.transcript}”
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              {heard.command.steps.map((step, index) => (
                <span
                  key={index}
                  className="rounded-full bg-sky-400/15 px-2 py-0.5 text-xs text-sky-200"
                >
                  {index + 1}. {describeStep(step)}
                </span>
              ))}
              {(['stop', 'hello', 'polite', 'praise', 'rude'] as const)
                .filter((flag) => heard.command[flag])
                .map((flag) => (
                  <span
                    key={flag}
                    className="rounded-full bg-amber-400/15 px-2 py-0.5 text-xs text-amber-200"
                  >
                    {flag}
                  </span>
                ))}
            </div>
            <p className="mt-2 font-mono text-xs text-amber-300">
              Decided in {heard.duration} ms
              {state.waiting > 0 && `, ${state.waiting} more in line`}
            </p>
          </>
        ) : (
          <p className="text-sm text-slate-400">
            {BRAIN_NAME} reads every sentence as up to three steps: an action, a
            target, a direction, a number of steps.
          </p>
        )}
      </section>

      <section className="rounded-2xl bg-white/[0.04] p-4">
        <h2 className="mb-2 font-semibold">Try saying</h2>
        <ul className="flex flex-col gap-1 text-sm text-slate-300">
          {SUGGESTIONS.map((suggestion) => (
            <li key={suggestion}>“{suggestion}”</li>
          ))}
        </ul>
      </section>
    </aside>
  )
}

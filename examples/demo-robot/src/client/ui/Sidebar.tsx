import { describeStep } from '../../shared/commands'
import type { Heard } from '../App'
import { GameState } from '../game/Game'
import { Quest, QUESTS } from '../game/world'

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

/** The quests, what Jev heard last, and a few things to say */
export default function Sidebar({
  state,
  heard,
}: {
  state: GameState
  heard?: Heard
}) {
  const done = (Object.keys(QUESTS) as Quest[]).filter(
    (quest) => state.quests[quest]
  ).length

  return (
    <aside className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto lg:w-80">
      <section className="rounded-2xl bg-white/5 p-4">
        <h2 className="mb-3 flex justify-between font-bold">
          Quests
          <span className="text-lime-300">
            {done}/{Object.keys(QUESTS).length} ⭐
          </span>
        </h2>
        <ul className="flex flex-col gap-2 text-sm">
          {(Object.keys(QUESTS) as Quest[]).map((quest) => {
            const complete = state.quests[quest]
            return (
              <li
                key={quest}
                className={`flex items-center gap-2 ${complete ? 'text-lime-300' : 'text-lime-50'}`}
              >
                <span>{complete ? '✅' : '⬜'}</span>
                <span className={complete ? 'line-through opacity-70' : ''}>
                  {QUESTS[quest]}
                </span>
              </li>
            )
          })}
        </ul>
      </section>

      <section className="rounded-2xl bg-white/5 p-4">
        <h2 className="mb-2 font-bold">What Jev heard</h2>
        {heard ? (
          <>
            <p className="text-sm italic text-lime-100">“{heard.transcript}”</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {heard.command.steps.map((step, index) => (
                <span
                  key={index}
                  className="rounded-full bg-lime-400/20 px-2 py-0.5 text-xs text-lime-200"
                >
                  {index + 1}. {describeStep(step)}
                </span>
              ))}
              {(['stop', 'hello', 'polite', 'praise', 'rude'] as const)
                .filter((flag) => heard.command[flag])
                .map((flag) => (
                  <span
                    key={flag}
                    className="rounded-full bg-amber-400/20 px-2 py-0.5 text-xs text-amber-200"
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
          <p className="text-sm text-lime-100/60">
            Every turn is read by Jev as up to three steps: an action, a target,
            a direction, a number of steps.
          </p>
        )}
      </section>

      <section className="rounded-2xl bg-white/5 p-4">
        <h2 className="mb-2 font-bold">Try saying</h2>
        <ul className="flex flex-col gap-1 text-sm text-lime-100/80">
          {SUGGESTIONS.map((suggestion) => (
            <li key={suggestion}>“{suggestion}”</li>
          ))}
        </ul>
      </section>
    </aside>
  )
}

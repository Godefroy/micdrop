import type { Call } from './Display'

/** The name of the demo, how it works, and the button to start the call */
export default function TopBar({
  call,
  onStart,
  onStop,
}: {
  call: Call
  onStart: () => void
  onStop: () => void
}) {
  return (
    <header className="flex shrink-0 items-center gap-4 border-b border-white/10 bg-[#0c1222] px-5 py-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-orange-400 to-rose-500 text-xl shadow-lg shadow-orange-500/20">
        🤖
      </div>
      <div className="min-w-0 flex-1">
        <h1 className="text-lg font-bold leading-tight">
          Bip, the robot you talk to
        </h1>
        <p className="truncate text-sm text-slate-400">
          Speech to text, then Jev from TypeSafe reads each sentence as a
          command in a few hundred ms. No LLM, no voice: Bip answers in beeps.
        </p>
      </div>
      {call.started ? (
        <button
          className="rounded-full border border-white/15 bg-white/5 px-5 py-2 text-sm font-semibold hover:bg-white/10"
          onClick={onStop}
        >
          Put Bip to sleep
        </button>
      ) : (
        <button
          className="rounded-full bg-gradient-to-r from-orange-400 to-rose-500 px-5 py-2 font-bold text-white shadow-lg shadow-rose-500/30 transition hover:brightness-110 disabled:opacity-60"
          onClick={onStart}
          disabled={call.starting}
        >
          {call.starting ? 'Waking Bip up…' : '🎙️ Wake Bip up'}
        </button>
      )}
    </header>
  )
}

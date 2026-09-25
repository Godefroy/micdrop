import type { Heard } from '../App'
import type { GameState } from '../game/Game'
import type { Look } from '../mode'
import Scene from './scene/Scene'
import Sidebar from './Sidebar'
import TopBar from './TopBar'

/** What the display needs to know about the call, read from Micdrop by App */
export interface Call {
  started: boolean
  starting: boolean
  /** The user is speaking */
  listening: boolean
  error?: string
}

interface DisplayProps {
  state: GameState
  call: Call
  heard?: Heard
  look: Look
  onStart: () => void
  onStop: () => void
}

/** The whole screen: a top bar, the garden in 3D, and a sidebar */
export default function Display({
  state,
  call,
  heard,
  look,
  onStart,
  onStop,
}: DisplayProps) {
  return (
    <div className="flex h-full flex-col">
      <TopBar call={call} onStart={onStart} onStop={onStop} />
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <main className="relative min-h-[60vh] flex-1 lg:min-h-0">
          <Scene
            state={state}
            look={look}
            asleep={!call.started}
            listening={call.listening}
          />
          {call.error && (
            <p className="absolute left-1/2 top-4 max-w-lg -translate-x-1/2 rounded-2xl bg-rose-950/90 px-4 py-2 text-sm text-rose-100 shadow-xl backdrop-blur">
              {call.error}
            </p>
          )}
          <Hint call={call} />
        </main>
        <Sidebar state={state} heard={heard} />
      </div>
    </div>
  )
}

/** A line at the bottom of the garden, saying what Bip is waiting for */
export function Hint({ call }: { call: Call }) {
  const text = !call.started
    ? 'Bip is asleep. Wake it up, then talk to it in English.'
    : call.listening
      ? 'Bip is listening…'
      : 'Tell Bip what to do.'
  return (
    <div className="pointer-events-none absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-slate-950/55 px-4 py-2 text-sm text-white shadow-lg backdrop-blur-md">
      <span
        className={`h-2 w-2 rounded-full ${
          !call.started
            ? 'bg-violet-300'
            : call.listening
              ? 'animate-pulse bg-rose-400'
              : 'bg-emerald-400'
        }`}
      />
      {text}
    </div>
  )
}

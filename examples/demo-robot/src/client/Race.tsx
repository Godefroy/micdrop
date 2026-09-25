import { useMicdropClassification, useMicdropState } from '@micdrop/react'
import {
  Micdrop,
  MicdropClassification,
  MicdropConversationItem,
} from '@micdrop/web'
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { Brain, RaceResult, toCommand } from '../shared/commands'
import { callOf, startCall } from './call'
import { Hint } from './display/Display'
import type { Call } from './display/Display'
import Scene from './display/scene/Scene'
import { Game } from './game/Game'

/** Two gardens where nothing moves on its own, heard left and right */
const GAMES: Record<Brain, Game> = {
  jev: new Game({ wander: false, pan: -0.7 }),
  claude: new Game({ wander: false, pan: 0.7 }),
}
const BRAINS: Brain[] = ['jev', 'claude']
const NAMES: Record<Brain, string> = { jev: 'Jev', claude: 'Claude' }

/** From the transcript to the command, measured in the browser */
interface Timer {
  start: number
  end?: number
}

/**
 * The race, behind `?race`: the same sentence goes to Jev and to Claude at
 * the same moment, and each answer plays on its own robot as soon as it
 * lands. A clock under each robot runs from the transcript to its command.
 */
export default function Race() {
  const call = callOf(useMicdropState())
  const [timers, setTimers] = useState<Partial<Record<Brain, Timer>>>({})
  const [models, setModels] = useState<Partial<Record<Brain, string>>>({})
  const [transcript, setTranscript] = useState<string>()

  // Both clocks start when the transcript lands, as both brains get it then
  useEffect(() => {
    const onMessage = (message: MicdropConversationItem) => {
      if (message.role !== 'user' || !('content' in message)) return
      const start = performance.now()
      setTimers({ jev: { start }, claude: { start } })
      setTranscript(message.content)
    }
    Micdrop.on('Message', onMessage)
    return () => {
      Micdrop.off('Message', onMessage)
    }
  }, [])

  const handleClassification = useCallback(
    ({ result }: MicdropClassification<RaceResult>) => {
      const end = performance.now()
      const { brain } = result
      setTimers((timers) => {
        const timer = timers[brain]
        return timer && !timer.end
          ? { ...timers, [brain]: { ...timer, end } }
          : timers
      })
      setModels((models) => ({ ...models, [brain]: result.model }))
      GAMES[brain].command(toCommand(result))
    },
    []
  )
  useMicdropClassification(handleClassification)

  return (
    <div className="relative h-full">
      <div className="absolute inset-0 grid grid-cols-2 gap-px bg-white/10">
        {BRAINS.map((brain) => (
          <Side
            key={brain}
            brain={brain}
            model={models[brain]}
            timer={timers[brain]}
            call={call}
          />
        ))}
      </div>
      {transcript && (
        <p className="pointer-events-none absolute left-1/2 top-24 max-w-[70%] -translate-x-1/2 rounded-2xl bg-slate-950/70 px-5 py-2 text-center text-lg text-white shadow-xl backdrop-blur">
          “{transcript}”
        </p>
      )}
      {call.error && (
        <p className="absolute left-1/2 top-40 max-w-lg -translate-x-1/2 rounded-2xl bg-rose-950/90 px-4 py-2 text-sm text-rose-100 shadow-xl backdrop-blur">
          {call.error}
        </p>
      )}
      <Hint call={call} />
      {!call.started && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#0c1222]/80 backdrop-blur-sm">
          <button
            className="rounded-full bg-gradient-to-r from-orange-400 to-rose-500 px-10 py-4 text-xl font-bold text-white shadow-lg shadow-rose-500/30 transition hover:brightness-110 disabled:opacity-60"
            onClick={startCall}
            disabled={call.starting}
          >
            {call.starting ? 'Starting…' : 'Start'}
          </button>
        </div>
      )}
    </div>
  )
}

function Side({
  brain,
  model,
  timer,
  call,
}: {
  brain: Brain
  model?: string
  timer?: Timer
  call: Call
}) {
  const game = GAMES[brain]
  const state = useSyncExternalStore(game.subscribe, game.getSnapshot)
  return (
    <main className="relative min-h-0 bg-[#0c1222]">
      <Scene
        state={state}
        look={brain}
        steady
        asleep={!call.started}
        listening={call.listening}
      />
      <div className="pointer-events-none absolute left-4 top-4 rounded-2xl bg-slate-950/70 px-4 py-2 shadow-xl backdrop-blur">
        <p className="text-xl font-bold leading-tight text-white">
          {NAMES[brain]}
        </p>
        {model && <p className="text-xs text-slate-400">{model}</p>}
      </div>
      <Clock timer={timer} />
    </main>
  )
}

/** Runs while the brain thinks, and stops on its answer */
function Clock({ timer }: { timer?: Timer }) {
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    if (!timer || timer.end) return
    let frame = 0
    const tick = () => {
      setNow(performance.now())
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [timer])

  if (!timer) return null
  const done = timer.end !== undefined
  const ms = Math.max(0, Math.round((timer.end ?? now) - timer.start))
  return (
    <div
      className={`pointer-events-none absolute bottom-16 left-1/2 -translate-x-1/2 rounded-2xl px-5 py-2 font-mono text-4xl font-bold tabular-nums shadow-xl backdrop-blur ${
        done
          ? 'bg-emerald-400/90 text-emerald-950'
          : 'bg-slate-950/70 text-white'
      }`}
    >
      {ms} ms
    </div>
  )
}

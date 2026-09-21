import { useMicdropClassification, useMicdropState } from '@micdrop/react'
import {
  Micdrop,
  MicdropClassification,
  MicdropClientError,
  MicdropClientErrorCode,
} from '@micdrop/web'
import { useCallback, useState, useSyncExternalStore } from 'react'
import { Command, JevResult, toCommand } from '../shared/commands'
import { game } from './game/Game'
import Confetti from './ui/Confetti'
import Garden from './ui/Garden'
import Sidebar from './ui/Sidebar'

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'ws://localhost:8095/call'

export interface Heard {
  transcript: string
  duration: number
  command: Command
}

export default function App() {
  const call = useMicdropState()
  const state = useSyncExternalStore(game.subscribe, game.getSnapshot)
  const [heard, setHeard] = useState<Heard>()

  // Each turn read by Jev becomes a command, played at once
  const handleClassification = useCallback(
    ({ input, duration, result }: MicdropClassification<JevResult>) => {
      const command = toCommand(result)
      setHeard({ transcript: input.turn, duration, command })
      game.command(command)
    },
    []
  )
  useMicdropClassification(handleClassification)

  const handleStart = async () => {
    await Micdrop.startMic({ vad: ['silero', 'volume'] })
    await Micdrop.start({ url: SERVER_URL })
  }

  return (
    <div className="flex h-full flex-col">
      <p className="bg-amber-300 px-4 py-2 text-center text-sm font-semibold text-amber-950">
        This demo uses only speech to text and Jev, a classification model from
        TypeSafe. No LLM: every move is decided in a few hundred ms from what
        you say.
      </p>
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 lg:flex-row">
        <main className="flex min-w-0 flex-1 flex-col items-center justify-center gap-4">
          <div className="flex w-full max-w-5xl items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">🤖 Bip</h1>
              <p className="text-sm text-lime-200/70">
                Talk to Bip, in English. It answers in beeps.
              </p>
            </div>
            {call.isStarted ? (
              <div className="flex items-center gap-3">
                <span
                  className={`h-3 w-3 rounded-full ${
                    call.isUserSpeaking
                      ? 'animate-pulse bg-rose-400'
                      : 'bg-lime-400'
                  }`}
                />
                <span className="text-sm text-lime-100">
                  {call.isUserSpeaking ? 'Listening…' : 'Talk to Bip'}
                </span>
                <button
                  className="rounded-full bg-white/10 px-4 py-2 text-sm hover:bg-white/20"
                  onClick={() => Micdrop.stop()}
                >
                  Stop
                </button>
              </div>
            ) : (
              <button
                className="rounded-full bg-lime-500 px-6 py-3 font-bold text-lime-950 shadow-lg hover:bg-lime-400 disabled:opacity-50"
                onClick={handleStart}
                disabled={call.isStarting}
              >
                {call.isStarting ? 'Waking Bip up…' : '🎙️ Wake Bip up'}
              </button>
            )}
          </div>

          {call.error && (
            <p className="w-full max-w-5xl rounded-xl bg-rose-950 px-4 py-2 text-sm text-rose-200">
              {errorText(call.error)}
              {call.isReconnecting && ' Reconnecting…'}
            </p>
          )}

          <div className="w-full max-w-5xl">
            <Garden state={state} />
          </div>
        </main>

        <Sidebar state={state} heard={heard} />
        {state.won && <Confetti />}
      </div>
    </div>
  )
}

/** The client errors carry a code, and rarely a message */
function errorText(error: MicdropClientError): string {
  switch (error.code) {
    case MicdropClientErrorCode.Mic:
      return 'The microphone is unavailable. Allow it in the browser and try again.'
    case MicdropClientErrorCode.Connection:
      return `The server at ${SERVER_URL} cannot be reached. Is it running?`
    case MicdropClientErrorCode.InternalServer:
      return 'The server failed to start. Check its logs and the API keys in .env.'
    default:
      return error.message || `Something went wrong (${error.code}).`
  }
}

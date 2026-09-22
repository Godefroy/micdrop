import { useMicdropState } from '@micdrop/react'
import {
  Micdrop,
  MicdropClientError,
  MicdropClientErrorCode,
} from '@micdrop/web'
import { useState } from 'react'
import { Mode, MODE_NAMES, MODES } from '../shared/modes'
import { VERDICTS } from '../shared/replies'
import Progress from './Progress'
import Transcript from './Transcript'
import { useGame } from './useGame'
import { VERDICT_STYLES } from './Verdict'

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'ws://localhost:8097/call'

/** Said in every mode, after the questions of the mode */
const COMMANDS = ['Give me a hint', 'I give up', 'New game']

export default function App() {
  const state = useMicdropState()
  const game = useGame()
  const [mode, setMode] = useState<Mode>('thing')
  const { emoji, title, suggestions } = MODES[mode]

  const handleStart = async () => {
    await Micdrop.startMic({ vad: ['silero', 'volume'] })
    await Micdrop.start({ url: `${SERVER_URL}?mode=${mode}` })
  }

  const handleStop = () => Micdrop.stop()

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-6 border-b border-white/10 px-6 py-4">
        <div>
          <h1 className="text-lg font-bold">Twenty questions</h1>
          <p className="text-sm text-slate-400">
            I think of something or someone, you find it with yes or no
            questions, out loud. Jev, TypeSafe's System One model, answers each
            one in a few hundred ms, with no LLM.
          </p>
        </div>
        {state.isStarted && (
          <div className="flex shrink-0 items-center gap-4">
            <span className="flex items-center gap-2 text-sm text-slate-400">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  state.isUserSpeaking
                    ? 'animate-pulse bg-rose-400'
                    : 'bg-emerald-400'
                }`}
              />
              {state.isUserSpeaking ? 'Listening…' : 'Ask away'}
            </span>
            <button
              className="rounded-full bg-white/10 px-5 py-2 text-sm font-medium hover:bg-white/20"
              onClick={handleStop}
            >
              Stop
            </button>
          </div>
        )}
      </header>

      {state.error && (
        <p className="bg-rose-950 px-6 py-2 text-sm text-rose-200">
          {errorText(state.error)}
          {state.isReconnecting && ' Reconnecting…'}
        </p>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-6 p-6 lg:flex-row">
        <main className="flex min-h-0 min-w-0 flex-1 flex-col items-center gap-6">
          <Progress game={game} />
          {state.isStarted ? (
            <div className="min-h-0 w-full max-w-2xl flex-1 overflow-y-auto">
              <Transcript game={game} />
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
              <p className="text-5xl">{emoji}</p>
              <h2 className="text-3xl font-bold tracking-tight">{title}</h2>
              <p className="max-w-md text-slate-400">
                Ask whatever comes to mind, the way you would ask a friend. No
                list of questions to pick from, and nothing to type.
              </p>
              <div
                role="tablist"
                aria-label="What the game thinks of"
                className="mt-2 flex rounded-full bg-white/5 p-1"
              >
                {MODE_NAMES.map((option) => (
                  <button
                    key={option}
                    role="tab"
                    aria-selected={option === mode}
                    disabled={state.isStarting}
                    onClick={() => setMode(option)}
                    className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                      option === mode
                        ? 'bg-emerald-500 text-emerald-950'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {MODES[option].tab}
                  </button>
                ))}
              </div>
              <button
                className="rounded-full bg-emerald-500 px-6 py-3 font-bold text-emerald-950 hover:bg-emerald-400 disabled:opacity-50"
                onClick={handleStart}
                disabled={state.isStarting}
              >
                {state.isStarting ? 'Starting…' : '🎙️ Start playing'}
              </button>
            </div>
          )}
        </main>

        <aside className="flex w-full shrink-0 flex-col gap-6 overflow-y-auto lg:w-72">
          <section>
            <h2 className="mb-2 text-sm font-semibold text-slate-300">
              How Jev answers
            </h2>
            <p className="mb-3 text-sm text-slate-400">
              Jev gives the probability of a yes. When it hesitates, because the
              question is ambiguous for the secret, the answer is “I don’t
              know”.
            </p>
            <ul className="flex flex-col gap-1.5 text-sm">
              {VERDICTS.map(({ verdict, min }, index) => (
                <li
                  key={verdict}
                  className="flex items-center justify-between gap-2"
                >
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${VERDICT_STYLES[verdict].className}`}
                  >
                    {VERDICT_STYLES[verdict].label}
                  </span>
                  <span className="font-mono text-xs text-slate-500">
                    {Math.round(min * 100)}–
                    {index ? Math.round(VERDICTS[index - 1].min * 100) : 100}%
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2 className="mb-2 text-sm font-semibold text-slate-300">
              Try asking
            </h2>
            <ul className="flex flex-col gap-1.5 text-sm text-slate-400">
              {[...suggestions, ...COMMANDS].map((suggestion) => (
                <li key={suggestion}>“{suggestion}”</li>
              ))}
            </ul>
          </section>
        </aside>
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

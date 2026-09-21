import { useMicdropState } from '@micdrop/react'
import {
  Micdrop,
  MicdropClientError,
  MicdropClientErrorCode,
} from '@micdrop/web'
import Conversation from './ui/Conversation'
import JevPanel from './ui/JevPanel'
import Suggestions from './ui/Suggestions'
import { useJev } from './useJev'

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'ws://localhost:8091/call'

export default function App() {
  const state = useMicdropState()
  const jev = useJev()

  const handleStart = async () => {
    await Micdrop.startMic({ vad: ['silero', 'volume'] })
    await Micdrop.start({ url: SERVER_URL })
  }

  const handleStop = () => Micdrop.stop()

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Nova Fiber support</h1>
          <p className="text-sm text-slate-400">
            A voice agent whose every turn is read by Jev, TypeSafe's System One
            model, which routes it before the LLM writes a word.
          </p>
        </div>
        {state.isStarted ? (
          <button
            className="rounded-full bg-rose-600 px-5 py-2 text-sm font-medium hover:bg-rose-500"
            onClick={handleStop}
          >
            Hang up
          </button>
        ) : (
          <button
            className="rounded-full bg-emerald-600 px-5 py-2 text-sm font-medium hover:bg-emerald-500 disabled:opacity-50"
            onClick={handleStart}
            disabled={state.isStarting}
          >
            {state.isStarting ? 'Calling…' : 'Call support'}
          </button>
        )}
      </header>

      {state.error && (
        <p className="rounded-lg bg-rose-950 px-4 py-2 text-sm text-rose-200">
          {errorText(state.error)}
          {state.isReconnecting && ' Reconnecting…'}
        </p>
      )}

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-6 md:grid-cols-[1fr_380px]">
        <section className="flex min-h-0 flex-col gap-4">
          <Conversation state={state} jev={jev} />
          <Suggestions />
        </section>
        <JevPanel jev={jev} />
      </main>
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
      return 'The server failed to start the call. Check its logs and the API keys in .env.'
    default:
      return error.message || `The call failed (${error.code}).`
  }
}

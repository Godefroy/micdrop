import { useMicdropState } from '@micdrop/react'
import {
  Micdrop,
  MicdropClientError,
  MicdropClientErrorCode,
} from '@micdrop/web'
import Deck from './Deck'
import JevBar from './JevBar'
import { useDeck } from './useDeck'

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'ws://localhost:8093/call'

const SUGGESTIONS = [
  'Create a title slide about the history of coffee',
  'Add three slides: a timeline of how coffee spread, key figures, and a famous quote',
  'Add a slide with a big photo of a coffee plantation',
  'Turn slide three into a comparison between arabica and robusta',
  'Delete the quote and the last slide, and add a closing section',
]

export default function App() {
  const state = useMicdropState()
  const deck = useDeck()
  // The assistant has no voice: its last answer is written instead
  const reply = [...state.conversation]
    .reverse()
    .find((item) => item.role === 'assistant')
  const replyText = reply && 'content' in reply ? reply.content : undefined

  const handleStart = async () => {
    await Micdrop.startMic({ vad: ['silero', 'volume'] })
    await Micdrop.start({ url: SERVER_URL })
  }

  const handleStop = () => Micdrop.stop()

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-6 border-b border-slate-800 px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold">Voice slides</h1>
          <p className="text-sm text-slate-400">
            Say what you want. Jev, TypeSafe's System One model, lays the slides
            out in a few hundred ms, and the LLM fills them.
          </p>
        </div>
        <div className="flex items-center gap-4">
          {state.isStarted && (
            <span className="text-sm text-slate-400">{status(state)}</span>
          )}
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
              {state.isStarting ? 'Starting…' : 'Start talking'}
            </button>
          )}
        </div>
      </header>

      {state.error && (
        <p className="bg-rose-950 px-6 py-2 text-sm text-rose-200">
          {errorText(state.error)}
          {state.isReconnecting && ' Reconnecting…'}
        </p>
      )}

      <JevBar deck={deck} />

      {replyText && (
        <p className="border-b border-slate-800 px-6 py-2 text-sm text-slate-300">
          💬 {replyText}
        </p>
      )}

      <main className="min-h-0 flex-1 overflow-y-auto p-6">
        {deck.slides.length === 0 && !deck.pending ? (
          <div className="mx-auto max-w-xl py-16 text-center">
            <p className="text-slate-400">
              Start talking, then try one of these:
            </p>
            <ul className="mt-4 flex flex-col gap-2 text-slate-200">
              {SUGGESTIONS.map((suggestion) => (
                <li key={suggestion}>“{suggestion}”</li>
              ))}
            </ul>
          </div>
        ) : (
          <Deck deck={deck} />
        )}
      </main>
    </div>
  )
}

function status(state: { isProcessing: boolean; isUserSpeaking: boolean }) {
  if (state.isUserSpeaking) return 'Listening…'
  if (state.isProcessing) return 'Working on it…'
  return 'Your turn'
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

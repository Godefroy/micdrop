import { useMicdropClassification, useMicdropState } from '@micdrop/react'
import {
  Micdrop,
  MicdropClassification,
  MicdropClientError,
  MicdropClientErrorCode,
} from '@micdrop/web'
import { useCallback, useState, useSyncExternalStore } from 'react'
import { Command, JevResult, toCommand } from '../shared/commands'
import Display from './display/Display'
import { game } from './game/Game'

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'ws://localhost:8095/call'

export interface Heard {
  transcript: string
  duration: number
  command: Command
}

/**
 * Everything Micdrop does in this demo: start the call, and turn each
 * classification of Jev into a command for the game. The rest is display.
 */
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
    <Display
      state={state}
      heard={heard}
      call={{
        started: call.isStarted,
        starting: call.isStarting,
        listening: call.isUserSpeaking,
        error: call.error
          ? errorText(call.error) +
            (call.isReconnecting ? ' Reconnecting…' : '')
          : undefined,
      }}
      onStart={handleStart}
      onStop={() => Micdrop.stop()}
    />
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

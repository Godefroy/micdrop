import { useMicdropClassification, useMicdropState } from '@micdrop/react'
import { Micdrop, MicdropClassification } from '@micdrop/web'
import { useCallback, useState, useSyncExternalStore } from 'react'
import { Command, JevResult, toCommand } from '../shared/commands'
import { callOf, startCall } from './call'
import Display from './display/Display'
import { game } from './game/Game'
import { LOOK, RACE } from './mode'
import Race from './Race'

export interface Heard {
  transcript: string
  duration: number
  command: Command
}

export default function App() {
  return RACE ? <Race /> : <Bip />
}

/**
 * Everything Micdrop does in this demo: start the call, and turn each
 * classification of Jev into a command for the game. The rest is display.
 */
function Bip() {
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

  return (
    <Display
      state={state}
      heard={heard}
      look={LOOK}
      call={callOf(call)}
      onStart={startCall}
      onStop={() => Micdrop.stop()}
    />
  )
}

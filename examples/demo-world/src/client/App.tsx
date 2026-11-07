import { Micdrop } from '@micdrop/web'
import { useMicdropEndCall, useMicdropState } from '@micdrop/react'
import { useEffect } from 'react'
import { Lang } from '../shared/lang'
import { decodeWorld } from '../shared/world'
import Experience from './Experience'
import MicdropDriver from './drivers/MicdropDriver'
import StartScreen from './ui/StartScreen'
import { useProgressTicker } from './store/hooks'
import { worldStore } from './store/WorldStore'

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'ws://localhost:8083/call'

export default function App() {
  const { isStarted, isStarting, error } = useMicdropState()

  // Gauges and achievements are discovered locally, from the same simulation
  // the server runs, so nothing has to be sent for something to be noticed.
  useProgressTicker()

  // A shared link restores the planet it points to, since a world is nothing
  // more than the numbers in the hash.
  useEffect(() => {
    const encoded = location.hash.slice(1)
    if (!encoded) return
    const world = decodeWorld(encoded)
    if (world) worldStore.setWorld(world)
  }, [])

  // The language chosen on the start screen decides what she speaks, which
  // pre-written lines she draws from, and the words of the interface.
  const handleStart = async (lang: Lang) => {
    worldStore.setLang(lang)
    await Micdrop.startMic({ vad: ['silero', 'volume'] })
    await Micdrop.start({ url: SERVER_URL, params: { lang } })
  }

  useMicdropEndCall(() => {
    // Let her finish her last sentence before the line goes quiet.
    Micdrop.stopAfterAnswer()
  })

  return (
    <div className="relative h-full w-full">
      <Experience />
      {isStarted && <MicdropDriver />}
      {!isStarted && (
        <StartScreen
          onStart={handleStart}
          starting={isStarting}
          error={error?.message}
        />
      )}
    </div>
  )
}

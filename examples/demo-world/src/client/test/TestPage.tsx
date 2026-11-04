import { useEffect, useState } from 'react'
import {
  CameraTarget,
  SCENE_EVENTS,
  SURGE_CHARGE,
  SURGE_RELEASE,
  SceneEventId,
  SurgeKind,
} from '../../shared/protocol'
import { decodeWorld } from '../../shared/world'
import Experience from '../Experience'
import { useProgressTicker } from '../store/hooks'
import { worldStore } from '../store/WorldStore'
import PresetPanel from './PresetPanel'
import { Group } from './Panel'
import ScenarioPanel from './ScenarioPanel'
import SimPanel from './SimPanel'
import StatePanel from './StatePanel'
import ToolPanel from './ToolPanel'
import WorldPanel from './WorldPanel'

/**
 * The whole front end without a call.
 *
 * It mounts the very same Experience the live page mounts, and drives it
 * through the very same store, so anything seen here is what a real
 * conversation produces. Nothing about Micdrop is imported on this page.
 */
export default function TestPage() {
  const [open, setOpen] = useState(true)

  useProgressTicker()

  // The bench exposes its store, so the browser console (and a headless probe)
  // can read and drive exactly what the interface reads.
  useEffect(() => {
    ;(window as any).__worldStore = worldStore
  }, [])

  // The same share link the live page reads, so a planet someone sent can be
  // opened straight into the bench. ?event= plays a catastrophe on load, which
  // is how the scripted animations get captured without clicking anything.
  useEffect(() => {
    const encoded = location.hash.slice(1)
    if (encoded) {
      const world = decodeWorld(encoded)
      if (world) worldStore.setWorld(world)
    }
    const params = new URLSearchParams(location.search)
    const requested = params.get('event')
    if (requested && requested in SCENE_EVENTS) {
      worldStore.playEvent(SCENE_EVENTS[requested as SceneEventId])
    }
    const look = params.get('look')
    if (look) worldStore.setLook(look as CameraTarget)
    const surge = params.get('surge')
    if (surge) {
      worldStore.playSurge({
        kind: surge as SurgeKind,
        duration: surge === 'charging' ? SURGE_CHARGE : SURGE_RELEASE,
        fields: [{ id: 'water', up: true }],
      })
    }
  }, [])

  return (
    <div className="relative h-full w-full">
      <Experience />

      <button
        type="button"
        tabIndex={0}
        aria-label={open ? 'Masquer le panneau' : 'Afficher le panneau'}
        className="absolute right-4 top-4 z-20 rounded-sm border border-white/15 bg-black/50 px-3 py-1 text-xs text-[#b6b3c8] backdrop-blur-sm transition hover:border-white/40"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') setOpen((value) => !value)
        }}
      >
        {open ? 'masquer' : 'panneau'}
      </button>

      {open && (
        <aside className="absolute right-0 top-0 z-10 h-full w-[340px] overflow-y-auto border-l border-white/10 bg-black/70 backdrop-blur-md">
          <header className="border-b border-white/10 px-4 py-3">
            <h1 className="text-xs uppercase tracking-[0.2em] text-[#8d8aa0]">
              banc d'essai
            </h1>
            <p className="mt-1 text-[11px] leading-relaxed text-[#5f5c72]">
              Même scène, même store, même chemin de commit que le serveur,
              démesure comprise. Aucune connexion, aucune clé d'API.
            </p>
          </header>

          {/* Four zones, in the order anyone actually works: play it, drive
              the server, drive the interface, then open the hood. */}
          <Group title="jouer" />
          <ScenarioPanel />
          <PresetPanel />

          <Group title="ce que fait le serveur" />
          <ToolPanel />

          <Group title="ce que montre l’interface" />
          <StatePanel />

          <Group title="sous le capot" />
          <SimPanel />
          <WorldPanel />
        </aside>
      )}
    </div>
  )
}

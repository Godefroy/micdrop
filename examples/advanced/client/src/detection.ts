import { SmartTurn, SmartTurnResult } from '@micdrop/smart-turn'
import {
  DEFAULT_TURN_MAX_WAIT,
  Micdrop,
  SileroVAD,
  TurnDetector,
  VADConfig,
  VolumeVAD,
} from '@micdrop/web'
import { useCallback, useSyncExternalStore } from 'react'

export type VADName = 'volume' | 'silero'

export const VAD_INFO: {
  name: VADName
  label: string
  help: string
}[] = [
  {
    name: 'volume',
    label: 'VolumeVAD',
    help: 'Detects speech from the microphone level. It reacts at once, but counts any loud noise as speech.',
  },
  {
    name: 'silero',
    label: 'SileroVAD',
    help: 'Detects speech with a small model that tells a voice apart from background noise.',
  },
]

export const SMART_TURN_HELP =
  'Detects whether a sentence is finished, so the assistant waits through a pause mid-sentence.'

/**
 * One instance of each detector for the whole session.
 *
 * Switching one off and back on then keeps the thresholds you had just moved,
 * and the Smart Turn model is downloaded once rather than on every toggle.
 */
export const vads = {
  volume: new VolumeVAD(),
  silero: new SileroVAD(),
}
export const smartTurn = new SmartTurn()

/**
 * The same detector, reporting what it answered.
 *
 * The point of the demo is to watch the model work, so every verdict and the
 * time it took land in the panel next to the thresholds.
 */
const turnDetector: TurnDetector = {
  push: (samples, sampleRate) => smartTurn.push(samples, sampleRate),
  reset: () => smartTurn.reset(),
  async predict() {
    const result = await smartTurn.predict()
    setState({ lastResult: result })
    return result
  },
}

const STORAGE_KEY = 'micdrop-demo-detection'

interface State {
  vads: Record<VADName, boolean>
  smartTurn: boolean
  /** Smart Turn runs on the server instead of the browser */
  serverTurnDetection: boolean
  /** How long a held turn waits before giving up on the rest of the sentence */
  maxWait: number
  loading: boolean
  error?: string
  lastResult?: SmartTurnResult
}

const DEFAULT_VADS: Record<VADName, boolean> = { volume: true, silero: true }

let state: State = {
  vads: readStored('vads', DEFAULT_VADS),
  smartTurn: readStored('smartTurn', true),
  serverTurnDetection: readStored('serverTurnDetection', false),
  maxWait: readStored('maxWait', DEFAULT_TURN_MAX_WAIT),
  loading: false,
}

const listeners = new Set<() => void>()

function readStored<
  K extends 'vads' | 'smartTurn' | 'maxWait' | 'serverTurnDetection',
>(key: K, fallback: State[K]): State[K] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return fallback
    const value = JSON.parse(stored)[key]
    if (value === undefined) return fallback
    return typeof fallback === 'object'
      ? ({ ...(fallback as object), ...value } as State[K])
      : value
  } catch {
    return fallback
  }
}

function persist() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        vads: state.vads,
        smartTurn: state.smartTurn,
        maxWait: state.maxWait,
        serverTurnDetection: state.serverTurnDetection,
      })
    )
  } catch {
    // A browser that refuses to store settings still runs the demo
  }
}

function setState(next: Partial<State>) {
  state = { ...state, ...next }
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The voice detection the microphone starts with */
export function getVADConfig(): VADConfig {
  const enabled = VAD_INFO.filter((info) => state.vads[info.name]).map(
    (info) => vads[info.name]
  )
  if (enabled.length === 0) return vads.volume
  if (enabled.length === 1) return enabled[0]
  return enabled
}

/**
 * The turn detection the call starts with.
 *
 * Only one side weighs a turn: the server can only ever decide to wait longer,
 * so running both would pay the round trip for nothing.
 */
export function getTurnDetector(): TurnDetector | undefined {
  return state.smartTurn && !state.serverTurnDetection
    ? turnDetector
    : undefined
}

/** Whether the server is asked to weigh the turns for this call */
export function getServerTurnDetection(): boolean {
  return state.serverTurnDetection
}

/** Hands turn detection to the server, or takes it back */
export function toggleServerTurnDetection(enabled: boolean) {
  setState({ serverTurnDetection: enabled, lastResult: undefined })
  persist()
  Micdrop.setTurnDetector(getTurnDetector())
  if (!enabled && state.smartTurn) {
    void loadSmartTurn()
  }
}

/** Switches one voice detector on or off, on a running microphone too */
export function toggleVAD(name: VADName, enabled: boolean) {
  const next = { ...state.vads, [name]: enabled }
  // The microphone always keeps at least one way of hearing speech
  if (!Object.values(next).some(Boolean)) return
  setState({ vads: next })
  persist()
  if (Micdrop.isMicStarted) {
    Micdrop.startMic({ vad: getVADConfig() })
  }
}

/**
 * Says how long a held turn waits for the rest of the sentence.
 *
 * This is the way out of a wrong verdict: the model can hear an unfinished
 * sentence where there is none, and the speaker who never comes back still
 * gets an answer once this runs out.
 */
export function setMaxWait(milliseconds: number) {
  setState({ maxWait: milliseconds })
  persist()
  Micdrop.setTurnMaxWait(milliseconds)
}

/** Puts the threshold and the wait back to what they started with */
export function resetSmartTurnOptions() {
  smartTurn.resetOptions()
  setMaxWait(DEFAULT_TURN_MAX_WAIT)
}

/** Switches turn detection on or off, downloading the model on first use */
export async function toggleSmartTurn(enabled: boolean) {
  setState({ smartTurn: enabled, error: undefined, lastResult: undefined })
  persist()
  Micdrop.setTurnDetector(getTurnDetector())
  if (enabled) await loadSmartTurn()
}

/** Fetches the model, and gives up on the setting when it cannot */
async function loadSmartTurn() {
  setState({ loading: true })
  try {
    await smartTurn.load()
  } catch (error) {
    setState({ smartTurn: false, error: String(error) })
    persist()
    Micdrop.setTurnDetector(undefined)
  } finally {
    setState({ loading: false })
  }
}

/** Reads the detection settings, and rerenders whichever panel shows them */
export function useDetection() {
  const current = useSyncExternalStore(subscribe, () => state)
  return {
    ...current,
    toggleVAD: useCallback(toggleVAD, []),
    toggleSmartTurn: useCallback(toggleSmartTurn, []),
    setMaxWait: useCallback(setMaxWait, []),
    resetSmartTurnOptions: useCallback(resetSmartTurnOptions, []),
    toggleServerTurnDetection: useCallback(toggleServerTurnDetection, []),
  }
}

// The choice made in a previous session applies before the microphone starts
Micdrop.setTurnMaxWait(state.maxWait)
Micdrop.setTurnDetector(getTurnDetector())
if (state.smartTurn && !state.serverTurnDetection) {
  void loadSmartTurn()
}

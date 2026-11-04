import { useSyncExternalStore } from 'react'

/** Whether the user may speak over the assistant, set for the next call */
const STORAGE_KEY = 'micdrop-demo-interruptions'

const listeners = new Set<() => void>()

function load(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'false'
  } catch {
    return true
  }
}

let enabled = load()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getInterruptionsEnabled(): boolean {
  return enabled
}

export function setInterruptionsEnabled(next: boolean) {
  enabled = next
  try {
    localStorage.setItem(STORAGE_KEY, String(next))
  } catch {
    // A browser refusing to store just forgets the choice on reload
  }
  listeners.forEach((listener) => listener())
}

export function useInterruptionsEnabled(): boolean {
  return useSyncExternalStore(
    subscribe,
    getInterruptionsEnabled,
    getInterruptionsEnabled
  )
}

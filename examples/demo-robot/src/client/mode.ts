import type { Brain } from '../shared/commands'

/**
 * Hidden options of the demo, read in the URL:
 * - `?race`: two robots side by side, one on Jev, one on Claude, same sentence
 * - `?brain=claude`: a single robot on Claude instead of Jev
 * - `?look=jev` or `?look=claude`: dresses the single robot as one of them
 */
const params = new URLSearchParams(window.location.search)

export const RACE = params.has('race')

export const BRAIN: Brain = params.get('brain') === 'claude' ? 'claude' : 'jev'

/** The name of the model reading each sentence, for the interface */
export const BRAIN_NAME = BRAIN === 'claude' ? 'Claude' : 'Jev'

export type Look = 'bip' | Brain

const look = params.get('look')
export const LOOK: Look = look === 'jev' || look === 'claude' ? look : 'bip'

/** The same options, for the server */
export const CALL_QUERY = RACE
  ? '?race'
  : BRAIN === 'claude'
    ? '?brain=claude'
    : ''

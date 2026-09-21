/**
 * The garden: a grid seen from above, the things in it, and the quests.
 */

export const WIDTH = 16
export const HEIGHT = 10

/**
 * `.` grass, `=` path, `~` pond, `H` house. The pond and the house cannot be
 * walked through.
 */
export const TERRAIN = [
  'HHHH......~~~~..',
  'HHHH......~~~~..',
  'HHHH=.....~~~...',
  '....=...........',
  '....==========..',
  '........=.......',
  '........=.......',
  '........=.......',
  '........=.......',
  '................',
]

export type Tile = '.' | '=' | '~' | 'H'

export function tileAt(x: number, y: number): Tile | undefined {
  return TERRAIN[y]?.[x] as Tile | undefined
}

export type Kind =
  | 'flower'
  | 'bucket'
  | 'ball'
  | 'cat'
  | 'dog'
  | 'apple_tree'
  | 'apple'
  | 'banana'
  | 'tree'
  | 'wood'
  | 'fish'
  | 'lamp'
  | 'chest'
  | 'star'

export interface Entity {
  id: string
  kind: Kind
  x: number
  y: number
  /** Carried by Bip, and drawn on its head */
  held?: boolean
  /** Gone for good: eaten, thrown away */
  gone?: boolean
  /** Flowers: watered. Lamp: on. Chest: open. */
  on?: boolean
}

export const EMOJI: Record<Kind, string> = {
  flower: '🌻',
  bucket: '🪣',
  ball: '⚽',
  cat: '🐈',
  dog: '🐕',
  apple_tree: '🌳',
  apple: '🍎',
  banana: '🍌',
  tree: '🌲',
  wood: '🪵',
  fish: '🐟',
  lamp: '💡',
  chest: '🧰',
  star: '⭐',
}

export const PETS: Kind[] = ['cat', 'dog']
export const PICKABLE: Kind[] = [
  'bucket',
  'ball',
  'apple',
  'banana',
  'wood',
  'fish',
  'star',
]

/** What each pet is happy to get. Both play ball and love fish. */
export const LIKES: Partial<Record<Kind, Kind[]>> = {
  cat: ['ball', 'fish'],
  dog: ['ball', 'fish', 'apple', 'banana', 'wood'],
}

export function initialEntities(): Entity[] {
  return [
    { id: 'flower', kind: 'flower', x: 7, y: 5 },
    { id: 'bucket', kind: 'bucket', x: 9, y: 3 },
    { id: 'ball', kind: 'ball', x: 13, y: 7 },
    { id: 'cat', kind: 'cat', x: 4, y: 8 },
    { id: 'dog', kind: 'dog', x: 11, y: 6 },
    { id: 'apple_tree', kind: 'apple_tree', x: 2, y: 7 },
    { id: 'banana', kind: 'banana', x: 5, y: 5 },
    { id: 'tree-1', kind: 'tree', x: 15, y: 0 },
    { id: 'tree-2', kind: 'tree', x: 0, y: 5 },
    { id: 'tree-3', kind: 'tree', x: 15, y: 7 },
    { id: 'tree-4', kind: 'tree', x: 0, y: 9 },
    { id: 'lamp', kind: 'lamp', x: 5, y: 1 },
    { id: 'chest', kind: 'chest', x: 14, y: 9 },
  ]
}

export const QUESTS = {
  hello: 'Say hello to Bip',
  lamp: 'Turn on the lamp',
  flower: 'Water the flower',
  ball: 'Bring the ball to the cat or the dog',
  treat: 'Give the dog an apple or a banana',
  fish: 'Catch a fish and give it to a pet',
  tree: 'Cut down a tree',
  chest: 'Open the treasure chest',
} as const

export type Quest = keyof typeof QUESTS

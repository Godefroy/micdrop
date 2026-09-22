/** What the game can think of, picked in tabs before a call */
export const MODES = {
  thing: {
    tab: 'Something',
    emoji: '🤔',
    title: 'Guess the word',
    suggestions: [
      'Is it alive?',
      'Can you eat it?',
      'Is it bigger than a car?',
      'Do you find it in a city?',
      'Is it something you wear?',
      'Is it a banana?',
    ],
  },
  person: {
    tab: 'Someone',
    emoji: '🎭',
    title: 'Who am I?',
    suggestions: [
      'Are you a real person?',
      'Are you a woman?',
      'Are you still alive?',
      'Did you live before 1900?',
      'Are you famous for music?',
      'Are you Marie Curie?',
    ],
  },
} as const

export type Mode = keyof typeof MODES
export const MODE_NAMES = Object.keys(MODES) as Mode[]

export function toMode(value: unknown): Mode {
  return MODE_NAMES.includes(value as Mode) ? (value as Mode) : 'thing'
}

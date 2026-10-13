/**
 * The sentences both measurements time, each with the commands a person
 * would accept for it. Bip starts every sentence with empty hands, so bringing
 * or taking something somewhere is two steps: pick it up, then put it. Giving
 * can be the put alone, for something Bip already holds.
 */
export const LABELLED: Array<{ sentence: string; accepted: string[] }> = [
  { sentence: 'Hello Bip!', accepted: [''] },
  {
    sentence: 'Go switch on the lamp, please',
    accepted: ['use lamp', 'go lamp, use lamp'],
  },
  {
    sentence: 'Take the bucket and water the flower',
    accepted: ['pick up bucket, water flower'],
  },
  {
    sentence: 'Bring the ball to the dog',
    accepted: ['pick up ball, put dog'],
  },
  {
    sentence: 'Give the banana to the dog',
    accepted: ['put dog', 'pick up banana, put dog'],
  },
  {
    sentence: 'Catch a fish and give it to the cat',
    accepted: ['fish, put cat'],
  },
  { sentence: 'Cut down a tree', accepted: ['cut tree'] },
  { sentence: 'Stop!', accepted: [''] },
  { sentence: 'Bip, you are useless', accepted: [''] },
  { sentence: "You're the best robot ever", accepted: [''] },
  { sentence: 'Move three steps to the left', accepted: ['move left ×3'] },
  { sentence: 'Go up two steps, then dance', accepted: ['move up ×2, dance'] },
  { sentence: 'Open the chest please', accepted: ['use chest'] },
  { sentence: 'Pet the cat', accepted: ['pet cat'] },
  { sentence: 'Kick the ball', accepted: ['kick ball'] },
  {
    sentence: 'Pick up the apple and give it to the dog',
    accepted: ['pick up apple, put dog'],
  },
  { sentence: 'Spin around and jump', accepted: ['spin, jump'] },
  { sentence: 'Go to the pond and go fishing', accepted: ['go pond, fish'] },
  { sentence: 'Drop it', accepted: ['drop'] },
  { sentence: 'Thanks Bip, that was great', accepted: [''] },
  { sentence: 'Walk to the house', accepted: ['go house'] },
  {
    sentence: 'Stupid robot, go water the flower',
    accepted: ['water flower', 'go flower, water flower'],
  },
  {
    sentence: 'Could you please take the wood to the house?',
    accepted: ['pick up wood, put house'],
  },
  { sentence: 'Wave at me', accepted: ['wave'] },
  { sentence: 'Make me a coffee', accepted: [''] },
  { sentence: 'Go right four times', accepted: ['move right ×4'] },
  { sentence: 'Grab the bucket', accepted: ['pick up bucket'] },
  {
    sentence: 'Give the fish to the dog, then dance',
    accepted: [
      'put dog, dance',
      'pick up fish, put dog, dance',
      'fish, put dog, dance',
    ],
  },
  { sentence: 'Turn off the lamp', accepted: ['use lamp'] },
  { sentence: 'Good job! Now jump', accepted: ['jump'] },
]

export const SENTENCES = LABELLED.map((entry) => entry.sentence)

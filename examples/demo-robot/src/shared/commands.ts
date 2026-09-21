import type {
  ChoiceResponse,
  NoulResponse,
  Questions,
  SystemOneResult,
} from '@micdrop/typesafe'

/** What Bip knows how to do, as Jev reads it in a sentence */
export const ACTIONS = {
  go: 'Go to a place or next to something',
  move: 'Move in a direction, a number of steps',
  pick_up: 'Take, grab or pick up an object',
  drop: 'Put down what it holds, where it stands',
  put: 'Bring what it holds to someone or somewhere: give it, deliver it',
  water: 'Water the flower',
  use: 'Switch on or off, or open: the lamp, the chest',
  pet: 'Pet, stroke or cuddle an animal',
  kick: 'Kick, shoot or throw the ball',
  cut: 'Cut down or chop a tree',
  fish: 'Go fishing, catch a fish in the pond or the lake',
  dance: 'Dance',
  wave: 'Say hello, wave',
  spin: 'Spin around, turn on itself',
  jump: 'Jump',
  none: 'No action',
} as const

/** Everything a sentence can point at in the garden */
export const TARGETS = {
  flower: 'The flower, a sunflower',
  bucket: 'The bucket of water, to water the flower',
  ball: 'The ball',
  cat: 'The cat',
  dog: 'The dog',
  apple_tree: 'The apple tree',
  tree: 'A pine tree, that can be cut down',
  apple: 'An apple',
  banana: 'The banana',
  wood: 'The wood from a tree cut down, a log, a stick',
  fish: 'A fish',
  lamp: 'The lamp',
  chest: 'The treasure chest',
  pond: 'The pond, the lake',
  house: 'The house',
  none: 'Nothing in particular',
} as const

export type Action = keyof typeof ACTIONS
export type Target = keyof typeof TARGETS
export type Direction = 'up' | 'down' | 'left' | 'right'

const DIRECTIONS = {
  up: 'Up, north, forward',
  down: 'Down, south, backward',
  left: 'Left, west',
  right: 'Right, east',
  none: 'No direction',
}

/** A single step of a command, "pick up the ball" */
export interface Step {
  action: Exclude<Action, 'none'>
  target?: Target
  /** Where the object goes, for put */
  receiver?: Target
  direction?: Direction
  amount: number
}

/** What the user asked in a turn, and how they asked it */
export interface Command {
  steps: Step[]
  stop: boolean
  polite: boolean
  rude: boolean
  praise: boolean
  hello: boolean
}

export const MAX_STEPS = 3
const ORDINALS = ['first', 'second', 'third']

/**
 * Everything Jev is asked about a turn, in one request. The steps are
 * speculative: three are asked for each time, and the command reads as many
 * as the sentence holds.
 */
function buildQuestions() {
  const questions: Questions = {
    steps: {
      type: 'choice',
      instructions:
        'How many successive actions does `turn` ask the robot to do?',
      criteria: {
        '0': 'None, it is not an order for the robot',
        '1': 'One action',
        '2': 'Two actions, one after the other',
        '3': 'Three actions or more',
      },
    },
    stop: {
      type: 'noul',
      instructions: 'Does `turn` ask the robot to stop or cancel?',
    },
    polite: {
      type: 'noul',
      instructions: 'Is `turn` polite, with please or thanks?',
    },
    rude: {
      type: 'noul',
      instructions: 'Is `turn` rude or insulting towards the robot?',
    },
    praise: {
      type: 'noul',
      instructions: 'Does `turn` congratulate or compliment the robot?',
    },
    hello: {
      type: 'noul',
      instructions: 'Does `turn` greet the robot?',
    },
  }
  ORDINALS.forEach((ordinal, index) => {
    const n = index + 1
    const about = `the ${ordinal} action \`turn\` asks the robot to do`
    questions[`action${n}`] = {
      type: 'choice',
      instructions: `What is ${about}?`,
      criteria: ACTIONS,
    }
    questions[`target${n}`] = {
      type: 'choice',
      instructions: `What object or place is ${about} about? Read \`history\` to know what words like it, her or there stand for.`,
      criteria: TARGETS,
    }
    questions[`receiver${n}`] = {
      type: 'choice',
      instructions: `If ${about} puts, gives or throws an object somewhere, where does the object go, or who receives it? None when it is not that kind of action.`,
      criteria: TARGETS,
    }
    questions[`direction${n}`] = {
      type: 'choice',
      instructions: `In which direction is ${about}?`,
      criteria: DIRECTIONS,
    }
    questions[`amount${n}`] = {
      type: 'choice',
      instructions: `How many steps or times does ${about} say?`,
      criteria: { '1': null, '2': null, '3': null, '4': null, '5': null },
    }
  })
  return questions
}

export const QUESTIONS = buildQuestions()

export type JevResult = SystemOneResult<Record<string, any>> & {
  answers: Record<string, NoulResponse | ChoiceResponse>
}

/** Reads the answers of Jev as a command for Bip */
export function toCommand(result: JevResult): Command {
  const answers = result.answers
  const noul = (key: string) =>
    ((answers[key] as NoulResponse | undefined)?.noul ?? 0) > 0.5
  const choice = (key: string) =>
    (answers[key] as ChoiceResponse | undefined)?.choice

  const steps: Step[] = []
  const count = Number(choice('steps') ?? 0)
  for (let n = 1; n <= Math.min(count, MAX_STEPS); n++) {
    const action = choice(`action${n}`) as Action | undefined
    if (!action || action === 'none') continue
    const target = choice(`target${n}`) as Target | undefined
    const receiver = choice(`receiver${n}`) as Target | undefined
    const direction = choice(`direction${n}`)
    steps.push({
      action,
      target: target === 'none' ? undefined : target,
      receiver: receiver === 'none' ? undefined : receiver,
      direction: direction === 'none' ? undefined : (direction as Direction),
      amount: Number(choice(`amount${n}`) ?? 1),
    })
  }

  return {
    steps,
    stop: noul('stop'),
    polite: noul('polite'),
    rude: noul('rude'),
    praise: noul('praise'),
    hello: noul('hello'),
  }
}

/** A step in a few words, for the interface */
export function describeStep(step: Step): string {
  const parts: string[] = [step.action.replace('_', ' ')]
  if (step.action === 'move') {
    parts.push(`${step.direction ?? '?'} ×${step.amount}`)
  } else if (step.action === 'put' && step.receiver) {
    parts.push(step.receiver.replace('_', ' '))
  } else if (step.target) {
    parts.push(step.target.replace('_', ' '))
  }
  return parts.join(' ')
}

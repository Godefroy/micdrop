// Load environment variables before importing anything else
import * as dotenv from 'dotenv'
dotenv.config({ quiet: true })

import { MicdropTurnInput } from '@micdrop/server'
import { mkdirSync, writeFileSync } from 'fs'
import {
  Brain,
  Command,
  describeStep,
  JevResult,
  toCommand,
} from '../shared/commands'
import { BRAINS } from './brains'

/**
 * Times Jev and Claude on the same sentences, sent to both at the same
 * moment, as in the race. The time is the one a classification measures: from
 * the request to the answer, on this machine and its network. Speech to text
 * is left out, both brains get the same text.
 *
 *   pnpm measure
 *   ROUNDS=5 CLAUDE_MODEL=claude-sonnet-5 pnpm measure
 */

const SENTENCES = [
  'Hello Bip!',
  'Go switch on the lamp, please',
  'Take the bucket and water the flower',
  'Bring the ball to the dog',
  'Give the banana to the dog',
  'Catch a fish and give it to the cat',
  'Cut down a tree',
  'Stop!',
  'Bip, you are useless',
  "You're the best robot ever",
  'Move three steps to the left',
  'Go up two steps, then dance',
  'Open the chest please',
  'Pet the cat',
  'Kick the ball',
  'Pick up the apple and give it to the dog',
  'Spin around and jump',
  'Go to the pond and go fishing',
  'Drop it',
  'Thanks Bip, that was great',
  'Walk to the house',
  'Stupid robot, go water the flower',
  'Could you please take the wood to the house?',
  'Wave at me',
  'Make me a coffee',
  'Go right four times',
  'Grab the bucket',
  'Give the fish to the dog, then dance',
  'Turn off the lamp',
  'Good job! Now jump',
]

const WARMUP = 3
const ROUNDS = Number(process.env.ROUNDS || 3)

interface Sample {
  sentence: string
  durations: Partial<Record<Brain, number>>
  commands: Partial<Record<Brain, Command>>
}

async function measure() {
  for (const key of ['TYPESAFE_API_KEY', 'ANTHROPIC_API_KEY']) {
    if (!process.env[key]) throw new Error(`${key} is missing from .env`)
  }
  const brains = { jev: BRAINS.jev(), claude: BRAINS.claude() }
  const model = process.env.CLAUDE_MODEL || 'claude-haiku-4-5'

  const run = async (sentence: string): Promise<Sample> => {
    const input: MicdropTurnInput = { history: [], turn: sentence }
    const sample: Sample = { sentence, durations: {}, commands: {} }
    await Promise.all(
      (Object.keys(brains) as Brain[]).map(async (brain) => {
        const classification = await brains[brain].classify(input)
        if (!classification) return
        sample.durations[brain] = classification.duration
        sample.commands[brain] = toCommand(
          classification.result as Pick<JevResult, 'answers'>
        )
      })
    )
    return sample
  }

  // The first requests open connections, and Claude compiles its schema
  console.log(
    `Warming up, then ${ROUNDS} rounds of ${SENTENCES.length} sentences`
  )
  for (const sentence of SENTENCES.slice(0, WARMUP)) await run(sentence)

  const samples: Sample[] = []
  for (let round = 0; round < ROUNDS; round++) {
    for (const sentence of SENTENCES) {
      samples.push(await run(sentence))
      process.stdout.write('.')
    }
  }
  process.stdout.write('\n\n')

  const stats = (brain: Brain) => {
    const values = samples
      .map((s) => s.durations[brain])
      .filter((v): v is number => v !== undefined)
      .sort((a, b) => a - b)
    const at = (p: number) =>
      values[Math.min(values.length - 1, Math.ceil(p * values.length) - 1)]
    return {
      count: values.length,
      failed: samples.length - values.length,
      median: at(0.5),
      p95: at(0.95),
      mean: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
      min: values[0],
      max: values[values.length - 1],
    }
  }
  const results = { jev: stats('jev'), claude: stats('claude') }

  const both = samples.filter((s) => s.commands.jev && s.commands.claude)
  const same = both.filter(
    (s) => describe(s.commands.jev!) === describe(s.commands.claude!)
  )
  const disagreements = [
    ...new Map(
      both
        .filter((s) => !same.includes(s))
        .map((s) => [
          s.sentence,
          {
            sentence: s.sentence,
            jev: describe(s.commands.jev!),
            claude: describe(s.commands.claude!),
          },
        ])
    ).values(),
  ]

  console.log(`| | Jev | ${model} |`)
  console.log('|---|---|---|')
  for (const key of ['median', 'p95', 'mean', 'min', 'max'] as const) {
    console.log(
      `| ${key} | ${results.jev[key]} ms | ${results.claude[key]} ms |`
    )
  }
  console.log(`| failed | ${results.jev.failed} | ${results.claude.failed} |\n`)
  console.log(
    `${Math.round((results.claude.median / results.jev.median) * 10) / 10}x faster at the median. ` +
      `Same command on ${same.length} of ${both.length} sentences.`
  )
  for (const d of disagreements) {
    console.log(
      `- "${d.sentence}"\n    Jev:    ${d.jev}\n    Claude: ${d.claude}`
    )
  }

  mkdirSync('measurements', { recursive: true })
  const file = `measurements/${new Date().toISOString().slice(0, 10)}-${model}.json`
  writeFileSync(
    file,
    JSON.stringify(
      {
        date: new Date().toISOString(),
        model,
        rounds: ROUNDS,
        results,
        agreement: { same: same.length, of: both.length },
        disagreements,
        samples,
      },
      null,
      2
    )
  )
  console.log(`\nSaved in ${file}`)
}

/** A command in a few words, to compare what each brain understood */
function describe(command: Command) {
  const flags = (['stop', 'polite', 'rude', 'praise', 'hello'] as const).filter(
    (flag) => command[flag]
  )
  const steps = command.steps.map(describeStep)
  return [...steps, ...flags.map((f) => `[${f}]`)].join(', ') || '(nothing)'
}

measure().then(
  () => process.exit(0),
  (error) => {
    console.error(error)
    process.exit(1)
  }
)

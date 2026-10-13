// Load environment variables before importing anything else
import * as dotenv from 'dotenv'
dotenv.config({ quiet: true })

import {
  choice,
  OpenaiClassifier,
  OpenaiQuestions,
  predicate,
} from '@micdrop/openai'
import { Classifier, MicdropTurnInput } from '@micdrop/server'
import { TypesafeClassifier } from '@micdrop/typesafe'
import { mkdirSync, writeFileSync } from 'fs'
import {
  Command,
  describeStep,
  JevResult,
  QUESTIONS,
  Step,
  toCommand,
} from '../shared/commands'
import { ClaudeClassifier } from './ClaudeClassifier'
import { LABELLED } from './sentences'

/**
 * Times three classifiers on the same sentences, sent to the three at the
 * same moment: Jev, the Decisions API of OpenAI, and Claude with structured
 * outputs. Next to the time of each request, it keeps the command each one
 * read, compared with the commands accepted in `sentences.ts`, the requests
 * that failed, the questions refused, the tokens and what they cost.
 *
 *   pnpm measure:classifiers
 *   ROUNDS=5 pnpm measure:classifiers
 */

const ROUNDS = Number(process.env.ROUNDS || 3)
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-4-5'
const OPENAI_MODEL = 'gpt-6-luna'

/** Public prices in USD per million tokens, read on 2026-10-13 */
const PRICES: Record<string, { input: number; output: number }> = {
  jev: { input: 0.042, output: 0 },
  [OPENAI_MODEL]: { input: 0.1, output: 0 },
  'claude-haiku-4-5': { input: 1, output: 5 },
}

/** Under this confidence in the number of steps, a command counts as unsure */
const UNSURE = 0.6

type Name = 'jev' | 'openai' | 'claude'
const NAMES: Name[] = ['jev', 'openai', 'claude']
const MODELS: Record<Name, string> = {
  jev: 'jev',
  openai: OPENAI_MODEL,
  claude: CLAUDE_MODEL,
}

interface Usage {
  input_tokens: number
  output_tokens: number
}

interface Reading {
  duration: number
  command: Command
  usage: Usage
  refusals: string[]
  /** Confidence in the number of steps, from the models that give one */
  countConfidence?: number
}

interface Sample {
  sentence: string
  readings: Partial<Record<Name, Reading>>
}

/** The questions of Jev, written for the Decisions API */
function openaiQuestions(): OpenaiQuestions {
  const questions: OpenaiQuestions = {}
  for (const [key, question] of Object.entries(QUESTIONS)) {
    const instructions = String(question.instructions)
    if (question.type === 'noul') {
      questions[key] = predicate(instructions)
    } else if (question.type === 'choice') {
      questions[key] = choice(
        instructions,
        question.criteria as Record<string, string | null>
      )
    }
  }
  return questions
}

/** The answers of the Decisions API, in the shape `toCommand()` reads */
function fromOpenai(answers: Record<string, any>) {
  const result: Record<string, any> = {}
  for (const [key, answer] of Object.entries(answers)) {
    result[key] =
      'probability' in answer
        ? { noul: answer.probability }
        : { choice: answer.choice }
  }
  return { answers: result } as Pick<JevResult, 'answers'>
}

async function measure() {
  for (const key of [
    'TYPESAFE_API_KEY',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
  ]) {
    if (!process.env[key]) throw new Error(`${key} is missing from .env`)
  }
  const classifiers: Record<Name, Classifier> = {
    jev: new TypesafeClassifier({
      apiKey: process.env.TYPESAFE_API_KEY,
      questions: QUESTIONS,
    }),
    openai: new OpenaiClassifier({
      apiKey: process.env.OPENAI_API_KEY || '',
      model: OPENAI_MODEL,
      questions: openaiQuestions(),
    }),
    claude: new ClaudeClassifier({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: CLAUDE_MODEL,
      questions: QUESTIONS,
    }),
  }

  // A failed request resolves with nothing: its error is read from the logs
  const errors: Record<Name, string[]> = { jev: [], openai: [], claude: [] }
  for (const name of NAMES) {
    classifiers[name].logger = {
      log: (...message: any[]) => {
        if (message[0] === 'Classification failed:') {
          errors[name].push(String(message[1]?.message ?? message[1]))
        }
      },
    } as any
  }

  const run = async (sentence: string): Promise<Sample> => {
    const input: MicdropTurnInput = { history: [], turn: sentence }
    const sample: Sample = { sentence, readings: {} }
    await Promise.all(
      NAMES.map(async (name) => {
        const classification = await classifiers[name].classify(input)
        if (!classification) return
        const result = classification.result
        sample.readings[name] = {
          duration: classification.duration,
          command: toCommand(
            name === 'openai' ? fromOpenai(result.answers) : result
          ),
          usage: {
            input_tokens: result.usage.input_tokens,
            output_tokens: result.usage.output_tokens,
          },
          refusals: result.refusals ?? [],
          countConfidence: result.answers.steps?.confidence,
        }
      })
    )
    return sample
  }

  // The first request of the process opens the connections, and Claude
  // compiles its schema: it is kept apart as the cold start
  const sentences = LABELLED.map((entry) => entry.sentence)
  console.log(
    `Cold start, then ${ROUNDS} rounds of ${sentences.length} sentences`
  )
  const cold = await run(sentences[0])
  for (const sentence of sentences.slice(1, 3)) await run(sentence)
  for (const name of NAMES) errors[name].length = 0

  const samples: Sample[] = []
  for (let round = 0; round < ROUNDS; round++) {
    for (const sentence of sentences) {
      samples.push(await run(sentence))
      process.stdout.write('.')
    }
  }
  process.stdout.write('\n\n')

  const accepted = new Map(LABELLED.map((e) => [e.sentence, e.accepted]))
  const isRight = (sample: Sample, name: Name) => {
    const reading = sample.readings[name]
    return (
      !!reading &&
      accepted.get(sample.sentence)!.includes(steps(reading.command))
    )
  }

  const isUnsure = (sample: Sample, name: Name) =>
    (sample.readings[name]?.countConfidence ?? 1) < UNSURE

  const stats = (name: Name) => {
    const readings = samples
      .map((s) => s.readings[name])
      .filter((r): r is Reading => r !== undefined)
    const values = readings.map((r) => r.duration).sort((a, b) => a - b)
    const at = (p: number) =>
      values[Math.min(values.length - 1, Math.ceil(p * values.length) - 1)]
    const sum = (pick: (r: Reading) => number) =>
      readings.reduce((total, r) => total + pick(r), 0)
    const inputTokens = Math.round(
      sum((r) => r.usage.input_tokens) / readings.length
    )
    const outputTokens = Math.round(
      sum((r) => r.usage.output_tokens) / readings.length
    )
    const price = PRICES[MODELS[name]]
    return {
      model: MODELS[name],
      count: values.length,
      failed: samples.length - values.length,
      errors: [...new Set(errors[name])],
      refusedQuestions: sum((r) => r.refusals.length),
      coldStart: cold.readings[name]?.duration,
      median: at(0.5),
      p95: at(0.95),
      mean: Math.round(sum((r) => r.duration) / values.length),
      min: values[0],
      max: values[values.length - 1],
      rightCommands: samples.filter((s) => isRight(s, name)).length,
      // Commands whose number of steps came with a confidence under 0.6
      unsure: {
        right: samples.filter((s) => isRight(s, name) && isUnsure(s, name))
          .length,
        wrong: samples.filter((s) => !isRight(s, name) && isUnsure(s, name))
          .length,
      },
      inputTokens,
      outputTokens,
      // USD for 1,000 requests of this size
      costPer1000: price
        ? Math.round(
            (inputTokens * price.input + outputTokens * price.output) * 1e3
          ) / 1e6
        : undefined,
    }
  }
  const results = {
    jev: stats('jev'),
    openai: stats('openai'),
    claude: stats('claude'),
  }

  // Two classifiers agree when they read the same steps and the same flags
  const agreement: Record<string, { same: number; of: number }> = {}
  const pairs: Array<[Name, Name]> = [
    ['jev', 'openai'],
    ['jev', 'claude'],
    ['openai', 'claude'],
  ]
  for (const [a, b] of pairs) {
    const both = samples.filter((s) => s.readings[a] && s.readings[b])
    agreement[`${a}-${b}`] = {
      same: both.filter(
        (s) =>
          describe(s.readings[a]!.command) === describe(s.readings[b]!.command)
      ).length,
      of: both.length,
    }
  }

  // Every different wrong reading of a sentence, with how often it came
  const mistakes = LABELLED.map((entry) => {
    const wrong: Partial<Record<Name, Record<string, number>>> = {}
    for (const sample of samples.filter((s) => s.sentence === entry.sentence)) {
      for (const name of NAMES) {
        if (isRight(sample, name)) continue
        const reading = sample.readings[name]
        const read = reading
          ? steps(reading.command) || '(nothing)'
          : '(failed)'
        wrong[name] = { ...wrong[name], [read]: (wrong[name]?.[read] ?? 0) + 1 }
      }
    }
    return { sentence: entry.sentence, accepted: entry.accepted, wrong }
  }).filter((entry) => Object.keys(entry.wrong).length > 0)

  const row = (label: string, pick: (r: (typeof results)[Name]) => unknown) =>
    console.log(
      `| ${label} | ${NAMES.map((n) => pick(results[n])).join(' | ')} |`
    )
  console.log(`| | ${NAMES.map((n) => MODELS[n]).join(' | ')} |`)
  console.log('|---|---|---|---|')
  row('median', (r) => `${r.median} ms`)
  row('p95', (r) => `${r.p95} ms`)
  row('min', (r) => `${r.min} ms`)
  row('max', (r) => `${r.max} ms`)
  row('cold start', (r) => `${r.coldStart} ms`)
  row('failed', (r) => r.failed)
  row('refused questions', (r) => r.refusedQuestions)
  row('right commands', (r) => `${r.rightCommands} of ${samples.length}`)
  row('unsure, right', (r) => r.unsure.right)
  row('unsure, wrong', (r) => r.unsure.wrong)
  row('input tokens', (r) => r.inputTokens)
  row('output tokens', (r) => r.outputTokens)
  row('USD per 1,000 requests', (r) => r.costPer1000)
  console.log()
  for (const [pair, { same, of }] of Object.entries(agreement)) {
    console.log(`${pair}: same command and flags on ${same} of ${of}`)
  }
  for (const mistake of mistakes) {
    console.log(
      `- "${mistake.sentence}" (accepted: ${mistake.accepted.join(' | ') || '(nothing)'})`
    )
    for (const name of NAMES) {
      if (mistake.wrong[name]) {
        console.log(`    ${name}: ${JSON.stringify(mistake.wrong[name])}`)
      }
    }
  }

  mkdirSync('measurements', { recursive: true })
  const file = `measurements/${new Date().toISOString().slice(0, 10)}-jev-${OPENAI_MODEL}-${CLAUDE_MODEL}.json`
  writeFileSync(
    file,
    JSON.stringify(
      {
        date: new Date().toISOString(),
        rounds: ROUNDS,
        prices: PRICES,
        results,
        agreement,
        mistakes,
        cold,
        samples,
      },
      null,
      2
    )
  )
  console.log(`\nSaved in ${file}`)
}

/** The steps of a command in a few words, to compare them with a label */
function steps(command: Command) {
  return command.steps.map(describeLoose).join(', ')
}

/** Fishing and dropping read the same whatever target came with them */
function describeLoose(step: Step) {
  return step.action === 'fish' || step.action === 'drop'
    ? step.action
    : describeStep(step)
}

/** A command with its flags, to compare what two classifiers understood */
function describe(command: Command) {
  const flags = (['stop', 'polite', 'rude', 'praise', 'hello'] as const).filter(
    (flag) => command[flag]
  )
  return (
    [...command.steps.map(describeLoose), ...flags.map((f) => `[${f}]`)].join(
      ', '
    ) || '(nothing)'
  )
}

measure().then(
  () => process.exit(0),
  (error) => {
    console.error(error)
    process.exit(1)
  }
)

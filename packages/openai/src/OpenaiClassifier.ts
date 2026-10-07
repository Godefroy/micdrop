import { Classifier, ClassifierInput } from '@micdrop/server'
import OpenAI from 'openai'
import { OpenaiOptions } from './OpenaiAgent'

/**
 * OpenAI classifier, running the Decisions API: typed questions (predicate,
 * choice, score) answered with probabilities, about 10x faster than the
 * Responses API.
 *
 * @see https://developers.openai.com/api/docs/guides/decisions
 */

/** The probability that a condition is true */
export interface OpenaiPredicateQuestion {
  type: 'predicate'
  instructions: string
}

/** One value out of several, without order */
export interface OpenaiChoiceQuestion<V extends string = string> {
  type: 'choice'
  instructions: string
  choices: Record<V, string | null>
}

/** A position on ordered levels, from the lowest */
export interface OpenaiScoreQuestion {
  type: 'score'
  instructions: string
  levels: Array<string | { label: string; description?: string }>
}

export type OpenaiQuestion =
  | OpenaiPredicateQuestion
  | OpenaiChoiceQuestion<any>
  | OpenaiScoreQuestion

export type OpenaiQuestions = Record<string, OpenaiQuestion>

/**
 * Asks for the probability that a condition is true
 * @param instructions - The condition, written around what can be observed
 */
export function predicate(instructions: string): OpenaiPredicateQuestion {
  return { type: 'predicate', instructions }
}

/**
 * Asks for one value out of several
 * @param instructions - The question
 * @param choices - Each value with a description of when it applies, or null
 */
export function choice<V extends string>(
  instructions: string,
  choices: Record<V, string | null>
): OpenaiChoiceQuestion<V> {
  return { type: 'choice', instructions, choices }
}

/**
 * Asks for a score on ordered levels
 * @param instructions - The question
 * @param levels - At least two levels, from the lowest up, each a label or a
 * label with a description
 */
export function score(
  instructions: string,
  levels: OpenaiScoreQuestion['levels']
): OpenaiScoreQuestion {
  return { type: 'score', instructions, levels }
}

export interface OpenaiPredicateAnswer {
  /** Probability that the condition is true, from 0 to 1 */
  probability: number
}

export interface OpenaiChoiceAnswer<V extends string = string> {
  choice: V
  confidence: number
  probabilities: Record<V, number>
}

export interface OpenaiScoreAnswer {
  /** Probability-weighted average of the level indices, from 0 */
  score: number
  confidence: number
  /** Probability of each level, by index */
  probabilities: Record<number, number>
}

export type OpenaiAnswer<Q extends OpenaiQuestion> =
  Q extends OpenaiChoiceQuestion<infer V>
    ? OpenaiChoiceAnswer<V>
    : Q extends OpenaiScoreQuestion
      ? OpenaiScoreAnswer
      : OpenaiPredicateAnswer

/** What an OpenAI classifier returns for its questions */
export interface OpenaiClassification<Q extends OpenaiQuestions> {
  /** The answer to each question, missing when the model refused it */
  answers: { [K in keyof Q]?: OpenaiAnswer<Q[K]> }
  /** The questions the model refused to answer */
  refusals: Array<keyof Q & string>
  usage: OpenAI.Decision['usage']
}

export type OpenaiClassifierOptions<Q extends OpenaiQuestions> =
  OpenaiOptions & {
    /** Model answering the questions, `gpt-6-luna` by default */
    model?: string

    /**
     * Questions asked about each input, built with `predicate()`, `choice()`
     * and `score()`. A function picks them per input.
     *
     * Every question is answered in a single request. Point at the fields of
     * the input by name, between backticks: in a call, `turn` and `history`.
     */
    questions: Q | ((input: ClassifierInput) => Q)

    /**
     * Builds what the model reads from the input: a text, or user messages
     * with text and images. The input as JSON by default, a text as is.
     */
    input?: (
      input: ClassifierInput
    ) => string | OpenAI.Decisions.DecisionInputMessage[]

    /** Identifies the end user to OpenAI, for abuse detection */
    safetyIdentifier?: string

    /** Timeout of each request in ms, 3000 by default */
    timeout?: number
  }

const DEFAULT_MODEL = 'gpt-6-luna'
const DEFAULT_TIMEOUT = 3000

export class OpenaiClassifier<Q extends OpenaiQuestions> extends Classifier<
  OpenaiClassification<Q>
> {
  private openai: OpenAI

  constructor(private options: OpenaiClassifierOptions<Q>) {
    super()
    this.openai =
      'openai' in options
        ? options.openai
        : new OpenAI({ apiKey: options.apiKey })
  }

  protected async evaluate(
    input: ClassifierInput,
    signal: AbortSignal
  ): Promise<OpenaiClassification<Q>> {
    const { questions, model, safetyIdentifier, timeout } = this.options
    const asked = typeof questions === 'function' ? questions(input) : questions
    const names = Object.keys(asked)

    const decision = await this.openai.decisions.create(
      {
        model: model || DEFAULT_MODEL,
        input: this.buildInput(input),
        questions: names.map((name) => buildQuestion(name, asked[name])),
        safety_identifier: safetyIdentifier,
      },
      { signal, timeout: timeout ?? DEFAULT_TIMEOUT, maxRetries: 0 }
    )

    const answers: Record<string, any> = {}
    const refusals: string[] = []
    decision.answers.forEach((answer, index) => {
      // Answers come in the order of the questions
      const name = answer.name ?? names[index]
      switch (answer.type) {
        case 'predicate':
          answers[name] = { probability: answer.probability }
          break
        case 'choice':
          answers[name] = {
            choice: answer.choice,
            confidence: answer.confidence,
            probabilities: Object.fromEntries(
              answer.probabilities.map((p) => [String(p.value), p.probability])
            ),
          }
          break
        case 'score':
          answers[name] = {
            score: answer.score,
            confidence: answer.confidence,
            probabilities: Object.fromEntries(
              answer.probabilities.map((p) => [p.value, p.probability])
            ),
          }
          break
        case 'refusal':
          refusals.push(name)
          break
      }
    })

    return {
      answers,
      refusals,
      usage: decision.usage,
    } as OpenaiClassification<Q>
  }

  private buildInput(input: ClassifierInput) {
    if (this.options.input) return this.options.input(input)
    return typeof input === 'string' ? input : JSON.stringify(input)
  }
}

function buildQuestion(
  name: string,
  question: OpenaiQuestion
): OpenAI.Decisions.DecisionCreateParams['questions'][number] {
  switch (question.type) {
    case 'predicate':
      return { type: 'predicate', name, instructions: question.instructions }
    case 'choice':
      return {
        type: 'choice',
        name,
        instructions: question.instructions,
        choices: Object.entries<string | null>(question.choices).map(
          ([value, description]) =>
            description ? { value, description } : { value }
        ),
      }
    case 'score':
      return {
        type: 'score',
        name,
        instructions: question.instructions,
        levels: question.levels.map((level) =>
          typeof level === 'string' ? { label: level } : level
        ),
      }
  }
}

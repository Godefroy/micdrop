import { Decisions, GoogleGenAI } from '@google/genai'
import { Classifier, ClassifierInput } from '@micdrop/server'
import { GeminiOptions } from './GeminiAgent'

/**
 * Gemini classifier, running the Decisions API: typed questions (yes or no,
 * choice, score) answered with calibrated probabilities by Gemini Decision 1,
 * without writing a single token.
 *
 * @see https://aistudio.google.com/docs/decisions-api
 */

/** What a question asks, a text or text blocks */
export type GeminiInstructions =
  | string
  | Decisions.DecisionInstructionContent
  | Decisions.DecisionInstructionContent[]

/** The probability that a condition is true */
export interface GeminiNoulQuestion {
  type: 'noul'
  instructions: GeminiInstructions
  criteria?: Decisions.NoulCriteria
}

/** One value out of several, without order */
export interface GeminiChoiceQuestion<V extends string = string> {
  type: 'choice'
  instructions: GeminiInstructions
  criteria: Record<V, string>
}

/** A position on ordered levels, from the lowest */
export interface GeminiScoreQuestion {
  type: 'score'
  instructions: GeminiInstructions
  criteria: string[]
}

export type GeminiQuestion =
  GeminiNoulQuestion | GeminiChoiceQuestion<any> | GeminiScoreQuestion

export type GeminiQuestions = Record<string, GeminiQuestion>

/**
 * Asks for the probability that a condition is true
 * @param instructions - The condition, written around what can be observed
 * @param criteria - What makes it true, and what makes it false
 */
export function noul(
  instructions: GeminiInstructions,
  criteria?: { true?: string; false?: string }
): GeminiNoulQuestion {
  return {
    type: 'noul',
    instructions,
    criteria: criteria && {
      true_description: criteria.true,
      false_description: criteria.false,
    },
  }
}

/**
 * Asks for one value out of several
 * @param instructions - The question
 * @param criteria - Each value with a description of when it applies, 2 to 255
 */
export function choice<V extends string>(
  instructions: GeminiInstructions,
  criteria: Record<V, string>
): GeminiChoiceQuestion<V> {
  return { type: 'choice', instructions, criteria }
}

/**
 * Asks for a score on ordered levels
 * @param instructions - The question
 * @param levels - Description of each level from the lowest up, 2 to 255
 */
export function score(
  instructions: GeminiInstructions,
  levels: string[]
): GeminiScoreQuestion {
  return { type: 'score', instructions, criteria: levels }
}

export interface GeminiNoulAnswer {
  type: 'noul'
  /** Probability that the condition is true, from 0.01 to 0.99 */
  noul: number
  /** Probability of the likelier outcome */
  confidence: number
}

export interface GeminiChoiceAnswer<V extends string = string> {
  type: 'choice'
  choice: V
  confidence: number
  probabilities: Record<V, number>
}

export interface GeminiScoreAnswer {
  type: 'score'
  /** Probability-weighted average of the level indices, from 0 */
  score: number
  confidence: number
  /** Probability of each level, by index */
  probabilities: Record<number, number>
  /** Description of each level, by index */
  legend: Record<number, string>
}

export type GeminiAnswer<Q extends GeminiQuestion> =
  Q extends GeminiChoiceQuestion<infer V>
    ? GeminiChoiceAnswer<V>
    : Q extends GeminiScoreQuestion
      ? GeminiScoreAnswer
      : GeminiNoulAnswer

/** What a Gemini classifier returns for its questions */
export interface GeminiClassification<Q extends GeminiQuestions> {
  /** The answer to each question */
  answers: { [K in keyof Q]: GeminiAnswer<Q[K]> }
  usage: Decisions.CreateDecisionResponse['usage']
}

export type GeminiClassifierOptions<Q extends GeminiQuestions> =
  GeminiOptions & {
    /** Model answering the questions, `gemini-decision-1` by default */
    model?: string

    /**
     * Questions asked about each input, built with `noul()`, `choice()` and
     * `score()`. A function picks them per input.
     *
     * Every question is answered in a single request, up to 1,000. Point at
     * the fields of the input by name, between backticks: in a call, `turn`
     * and `history`.
     */
    questions: Q | ((input: ClassifierInput) => Q)

    /**
     * Builds what the model reads from the input: a text, or blocks of text,
     * image, audio, video or PDF. The input as JSON by default, a text as is.
     */
    input?: (input: ClassifierInput) => Decisions.CreateDecisionRequest['input']

    /** Timeout of each request in ms, 3000 by default */
    timeout?: number
  }

const DEFAULT_MODEL = 'gemini-decision-1'
const DEFAULT_TIMEOUT = 3000
const API_VERSION = 'v1beta'

export class GeminiClassifier<Q extends GeminiQuestions> extends Classifier<
  GeminiClassification<Q>
> {
  private genai: GoogleGenAI

  constructor(private options: GeminiClassifierOptions<Q>) {
    super()
    this.genai =
      'genai' in options
        ? options.genai
        : new GoogleGenAI({ apiKey: options.apiKey })
  }

  protected async evaluate(
    input: ClassifierInput,
    signal: AbortSignal
  ): Promise<GeminiClassification<Q>> {
    const { questions, model, timeout } = this.options
    const asked = typeof questions === 'function' ? questions(input) : questions

    const decision = await this.genai.decisions.create(
      {
        model: model || DEFAULT_MODEL,
        input: this.buildInput(input),
        questions: asked,
        // Only on v1beta, while the client defaults to v1
        api_version: API_VERSION,
      },
      {
        // The SDK drops its timeout when a signal is given
        signal: AbortSignal.any([
          signal,
          AbortSignal.timeout(timeout ?? DEFAULT_TIMEOUT),
        ]),
        retries: { strategy: 'none' },
      }
    )

    // A blocked input comes back as an error, or as a feedback without answers
    const blocked = decision.prompt_feedback?.block_reason
    if (blocked) {
      const message = decision.prompt_feedback?.block_reason_message
      throw new Error(
        `Input blocked by Gemini (${blocked})${message ? `: ${message}` : ''}`
      )
    }

    return {
      answers: decision.answers ?? {},
      usage: decision.usage,
    } as GeminiClassification<Q>
  }

  private buildInput(input: ClassifierInput) {
    if (this.options.input) return this.options.input(input)
    return typeof input === 'string' ? input : JSON.stringify(input)
  }
}

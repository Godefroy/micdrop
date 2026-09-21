import { Classifier, ClassifierInput } from '@micdrop/server'
import {
  EntryType,
  Questions,
  SystemOneResult,
  TypeSafeClient,
} from '@typesafe-ai/sdk'

/**
 * TypeSafe classifier, running Jev, a System One model that answers typed
 * questions (choice, score, yes or no) with probabilities in 70 to 500 ms.
 *
 * @see https://docs.typesafe.ai
 */

export interface TypesafeClassifierOptions<Q extends Questions> {
  /** API key, read from `TYPESAFE_API_KEY` when left out */
  apiKey?: string

  /** Model answering the questions, `jev-latest` by default */
  model?: string

  /**
   * Questions asked about each input, built with `choice()`, `score()` and
   * `noul()`. A function picks them per input.
   *
   * Every question is answered in parallel, in a single request. Ask the
   * speculative ones too: the code reading the answers decides which ones
   * matter. Point at the fields of the input by name, between backticks: in a
   * call, `turn` and `history`.
   */
  questions: Q | ((input: ClassifierInput) => Q)

  /**
   * Builds what Jev reads from the input, to add fields next to it for
   * instance. The input itself by default.
   */
  state?: (input: ClassifierInput) => EntryType

  /** Timeout of each request in ms, 3000 by default */
  timeout?: number
}

/** What a TypeSafe classifier returns for its questions */
export type TypesafeClassification<Q extends Questions> = SystemOneResult<Q>

const DEFAULT_TIMEOUT = 3000

export class TypesafeClassifier<Q extends Questions> extends Classifier<
  SystemOneResult<Q>
> {
  private client: TypeSafeClient

  constructor(private options: TypesafeClassifierOptions<Q>) {
    super()
    this.client = new TypeSafeClient({
      apiKey: options.apiKey,
      defaultModel: options.model,
      timeout: options.timeout ?? DEFAULT_TIMEOUT,
    })
  }

  protected async evaluate(
    input: ClassifierInput,
    signal: AbortSignal
  ): Promise<SystemOneResult<Q>> {
    const { questions, state } = this.options
    return this.client.systemOne(
      {
        state: state ? state(input) : (input as EntryType),
        questions:
          typeof questions === 'function' ? questions(input) : questions,
      },
      { signal }
    )
  }
}

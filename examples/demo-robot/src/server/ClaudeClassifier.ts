import Anthropic from '@anthropic-ai/sdk'
import { Classifier, ClassifierInput } from '@micdrop/server'
import type { Questions } from '@micdrop/typesafe'

/** The answers of Claude, in the shape `toCommand()` reads from Jev */
export interface ClaudeResult {
  model: string
  answers: Record<string, { noul: number } | { choice: string }>
}

export interface ClaudeClassifierOptions {
  /** API key, read from `ANTHROPIC_API_KEY` when left out */
  apiKey?: string
  /** `claude-haiku-4-5` by default, the fastest Claude */
  model?: string
  /** The questions asked to Jev, asked to Claude as they are */
  questions: Questions
}

/**
 * Asks Claude the questions Jev answers, in a single request, with structured
 * outputs holding the answer to a JSON schema. It is here to race Jev: same
 * questions, same input, only the model changes.
 */
export class ClaudeClassifier extends Classifier<ClaudeResult> {
  private client: Anthropic
  private model: string
  private system: string
  private schema: Record<string, unknown>

  constructor(private options: ClaudeClassifierOptions) {
    super()
    this.client = new Anthropic({ apiKey: options.apiKey })
    this.model = options.model || 'claude-haiku-4-5'
    this.system = buildSystem(options.questions)
    this.schema = buildSchema(options.questions)
  }

  protected async evaluate(
    input: ClassifierInput,
    signal: AbortSignal
  ): Promise<ClaudeResult> {
    const response = await this.client.messages.create(
      {
        model: this.model,
        max_tokens: 1024,
        system: this.system,
        messages: [{ role: 'user', content: JSON.stringify(input) }],
        output_config: {
          format: { type: 'json_schema', schema: this.schema },
        },
      },
      { signal }
    )
    if (response.stop_reason !== 'end_turn') {
      throw new Error(`Claude stopped with ${response.stop_reason}`)
    }
    const block = response.content.find((b) => b.type === 'text')
    const values = JSON.parse(block?.type === 'text' ? block.text : '{}')

    const answers: ClaudeResult['answers'] = {}
    for (const [key, question] of Object.entries(this.options.questions)) {
      const value = values[key]
      answers[key] =
        question.type === 'noul'
          ? { noul: value === true ? 1 : 0 }
          : { choice: String(value) }
    }
    return { model: response.model, answers }
  }
}

/** The questions written out for Claude, with what each option means */
function buildSystem(questions: Questions) {
  const lines = [
    'You read what a user says to Bip, a small robot in a garden, and answer questions about it.',
    'The input is JSON: `turn` is what the user just said, `history` the turn before.',
    'Answer every question. When a question does not apply, pick the option meaning none.',
    '',
  ]
  for (const [key, question] of Object.entries(questions)) {
    lines.push(`${key}: ${text(question.instructions)}`)
    if (question.type === 'choice') {
      for (const [option, meaning] of Object.entries(question.criteria)) {
        lines.push(meaning ? `- ${option}: ${text(meaning)}` : `- ${option}`)
      }
    } else {
      lines.push('- true or false')
    }
  }
  return lines.join('\n')
}

function text(entry: unknown) {
  return typeof entry === 'string' ? entry : JSON.stringify(entry)
}

/** One property per question: an enum for a choice, a boolean for yes or no */
function buildSchema(questions: Questions) {
  const properties: Record<string, unknown> = {}
  for (const [key, question] of Object.entries(questions)) {
    if (question.type === 'score') {
      throw new Error(`Score questions are not supported: ${key}`)
    }
    properties[key] =
      question.type === 'choice'
        ? { type: 'string', enum: Object.keys(question.criteria) }
        : { type: 'boolean' }
  }
  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  }
}

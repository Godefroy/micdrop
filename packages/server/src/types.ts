export enum MicdropClientCommands {
  StartSpeaking = 'StartSpeaking',
  StopSpeaking = 'StopSpeaking',
  Mute = 'Mute',
}

export enum MicdropServerCommands {
  Message = 'Message',
  PartialAssistantMessage = 'PartialAssistantMessage',
  CancelLastUserMessage = 'CancelLastUserMessage',
  SkipAnswer = 'SkipAnswer',
  EndCall = 'EndCall',
  ToolCall = 'ToolCall',
  Classification = 'Classification',
}

/**
 * Hears whether a sentence has landed, where voice activity detection only
 * hears whether someone is speaking.
 *
 * `SmartTurn` from `@micdrop/smart-turn` implements it, and so can anything
 * else, a call to a service included. Both sides of a call can hold one, the
 * client to decide when its turn ends and the server to decide when to answer.
 */
export interface TurnDetector {
  /**
   * Feeds the audio received since the last call
   * @param samples - Mono samples, in the -1..1 range
   * @param sampleRate - Sample rate of `samples`, in Hz
   */
  push(samples: Float32Array, sampleRate?: number): void

  /** Answers whether the turn pushed so far sounds finished */
  predict(): Promise<{ complete: boolean }>

  /** Starts a new turn, forgetting the previous one */
  reset(): void
}

export interface MicdropCallSummary {
  conversation: MicdropConversation
  duration: number
}

export type MicdropConversationItem =
  | MicdropConversationMessage
  | MicdropConversationToolCall
  | MicdropConversationToolResult

export type MicdropConversation = Array<MicdropConversationItem>

export type MicdropAnswerMetadata = {
  [key: string]: any
}

export interface MicdropConversationMessage<
  Data extends MicdropAnswerMetadata = MicdropAnswerMetadata,
> {
  role: 'system' | 'user' | 'assistant'
  content: string
  metadata?: Data
}

export interface MicdropConversationToolCall {
  role: 'tool_call'
  toolCallId: string
  toolName: string
  parameters: string
}

export interface MicdropConversationToolResult {
  role: 'tool_result'
  toolCallId: string
  toolName: string
  output: string
}

/** What a classifier made of an input, a turn of the user in a call */
export interface MicdropClassification<Result = any, Input = any> {
  /** What was classified */
  input: Input
  /** Answers of the classifier, in the shape its provider returns */
  result: Result
  /** Time the classification took, in ms */
  duration: number
}

export interface MicdropToolCall {
  name: string
  parameters: any
  output: any
}

export type DeepPartial<T> = T extends object
  ? {
      [P in keyof T]?: DeepPartial<T[P]>
    }
  : T

/**
 * The turn of the user so far: the user messages at the end of the
 * conversation, one per transcript, joined with a space. It starts after the
 * last answer, or after the last user message already classified, which is
 * what tells two turns apart when no agent answers them.
 */
export function currentTurn(conversation: MicdropConversation) {
  let start = conversation.length
  while (start > 0) {
    const item = conversation[start - 1]
    if (item.role !== 'user' || item.metadata?.classification) break
    start--
  }
  const messages = conversation.slice(start) as MicdropConversationMessage[]
  return {
    transcript: messages.map((message) => message.content).join(' '),
    messages,
    before: conversation.slice(0, start),
  }
}

/**
 * The classification of the last turn of the user, which the server keeps in
 * the metadata of its last message. Undefined until one read the whole turn.
 */
export function getTurnClassification<Result = any>(
  conversation: MicdropConversation
): MicdropClassification<Result> | undefined {
  for (let index = conversation.length - 1; index >= 0; index--) {
    const item = conversation[index]
    if (item.role === 'user') return item.metadata?.classification
  }
  return undefined
}

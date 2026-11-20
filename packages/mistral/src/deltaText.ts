import type { DeltaMessage } from '@mistralai/mistralai/models/components'

/**
 * The text of a streamed delta.
 *
 * A model that reasons streams its content as an array: `thinking` chunks
 * first, then `text` chunks, the first word of the answer among them. Only
 * the text belongs to the answer, the reasoning is left out.
 *
 * @returns Undefined for a delta without content, a tool call for instance
 */
export function textOf(content: DeltaMessage['content']): string | undefined {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return undefined
  return content
    .map((chunk) => (chunk.type === 'text' ? chunk.text : ''))
    .join('')
}

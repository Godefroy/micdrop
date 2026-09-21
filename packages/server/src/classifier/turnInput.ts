import {
  currentTurn,
  MicdropConversation,
  MicdropConversationMessage,
} from '../types'
import { MicdropTurnInput } from './Classifier'

/**
 * Builds what `MicdropServer` classifies at the end of a turn: the turn
 * itself, and the turns before it with the answers that followed them.
 * @param conversation - The conversation, the turn at its end
 * @param history - How many turns of the user before this one to include
 * @returns The input, and the last message of the turn, which keeps the result
 */
export function turnInput(conversation: MicdropConversation, history = 1) {
  const turn = currentTurn(conversation)
  const input: MicdropTurnInput = { history: [], turn: turn.transcript }

  let rest = turn.before
  for (let n = 0; n < history && rest.length; n++) {
    // The answers that followed the turn before
    let end = rest.length
    const answers: string[] = []
    while (end > 0 && rest[end - 1].role !== 'user') {
      const item = rest[end - 1]
      if (item.role === 'assistant' && item.content.trim()) {
        answers.unshift(item.content)
      }
      end--
    }
    // That turn, which its classified last message closes
    let start = end
    while (start > 0) {
      const item = rest[start - 1]
      if (item.role !== 'user') break
      if (
        start < end &&
        (item as MicdropConversationMessage).metadata?.classification
      )
        break
      start--
    }

    if (answers.length) {
      input.history.unshift({ role: 'assistant', text: answers.join(' ') })
    }
    if (start < end) {
      const text = rest
        .slice(start, end)
        .map((item) => ('content' in item ? item.content : ''))
        .join(' ')
      input.history.unshift({ role: 'user', text })
    }
    rest = rest.slice(0, start)
  }

  return { input, message: turn.messages[turn.messages.length - 1] }
}

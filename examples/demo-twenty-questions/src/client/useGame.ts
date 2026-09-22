import { useMicdropState } from '@micdrop/react'
import { MicdropConversationMessage } from '@micdrop/web'
import { useEffect, useState } from 'react'
import { Reply } from '../shared/replies'

/** A line of the game: what the user said, what the game said back */
export type Line =
  | { role: 'user'; text: string }
  | { role: 'game'; text: string; reply?: Reply }

export interface GameView {
  lines: Line[]
  /** Questions asked so far */
  count: number
  /** The answer of each question, in order, for the progress */
  answers: Extract<Reply, { type: 'answer' }>[]
  end?: Extract<Reply, { type: 'won' | 'lost' }>
  /** A question waits for its answer */
  waiting: boolean
}

/** How long a turn can wait for an answer before it counts as ignored */
const WAIT = 2500

/**
 * The game as the conversation tells it: the server writes every answer, with
 * its reply in the metadata, and a new game starts with a `start` reply.
 */
export function useGame(): GameView {
  const { conversation } = useMicdropState()
  const messages = conversation.filter(
    (item): item is MicdropConversationMessage =>
      item.role === 'user' || item.role === 'assistant'
  )

  let start = 0
  messages.forEach((message, index) => {
    if ((message.metadata as Reply | undefined)?.type === 'start') start = index
  })

  const lines: Line[] = messages.slice(start).map((message) =>
    message.role === 'user'
      ? { role: 'user', text: message.content }
      : {
          role: 'game',
          text: message.content,
          reply: message.metadata as Reply | undefined,
        }
  )
  const replies = lines.flatMap((line) =>
    line.role === 'game' && line.reply ? [line.reply] : []
  )
  const answers = replies.filter(
    (reply): reply is Extract<Reply, { type: 'answer' }> =>
      reply.type === 'answer'
  )
  const end = replies.find(
    (reply): reply is Extract<Reply, { type: 'won' | 'lost' }> =>
      reply.type === 'won' || reply.type === 'lost'
  )
  const won = end?.type === 'won' ? 1 : 0

  // The last turn waits for its answer, unless it was not meant for the game
  const last = lines[lines.length - 1]
  const [waiting, setWaiting] = useState(false)
  useEffect(() => {
    if (last?.role !== 'user') {
      setWaiting(false)
      return
    }
    setWaiting(true)
    const timer = setTimeout(() => setWaiting(false), WAIT)
    return () => clearTimeout(timer)
  }, [last, lines.length])

  return {
    lines,
    count: answers.length + won,
    answers,
    end,
    waiting,
  }
}

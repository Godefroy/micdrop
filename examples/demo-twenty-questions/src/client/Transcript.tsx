import { useEffect, useRef } from 'react'
import { GameView } from './useGame'
import VerdictChip from './Verdict'

/**
 * The questions and their answers. Each answer shows the probability of a
 * yes Jev gave, the reason for "I don't know" when it sits in the middle.
 */
export default function Transcript({ game }: { game: GameView }) {
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [game.lines.length, game.waiting])

  const items: React.ReactNode[] = []
  game.lines.forEach((line, index) => {
    const next = game.lines[index + 1]
    if (line.role === 'user') {
      const reply = next?.role === 'game' ? next.reply : undefined
      if (reply?.type === 'answer') {
        items.push(
          <li
            key={index}
            className="animate-pop flex items-center justify-between gap-4 rounded-xl bg-white/5 px-4 py-3"
          >
            <span className="flex min-w-0 items-baseline gap-3">
              <span className="w-6 shrink-0 text-right font-mono text-xs text-slate-500">
                {reply.count}
              </span>
              <span className="text-slate-100">{reply.question}</span>
            </span>
            <VerdictChip
              verdict={reply.verdict}
              probability={reply.probability}
            />
          </li>
        )
        return
      }
      const pending = !next && game.waiting
      items.push(
        <li
          key={index}
          className={`px-4 text-sm ${pending ? 'animate-pulse text-slate-300' : 'text-slate-500'}`}
        >
          “{line.text}”{pending && ' …'}
          {reply?.type === 'ignored' && (
            <span className="ml-2 rounded-full bg-white/5 px-2 py-0.5 text-xs">
              not a question
            </span>
          )}
        </li>
      )
      return
    }
    // The answers are shown next to their question
    if (line.reply?.type === 'answer' || line.reply?.type === 'ignored') return
    const tone =
      line.reply?.type === 'won'
        ? 'bg-emerald-500 font-bold text-emerald-950'
        : line.reply?.type === 'lost'
          ? 'bg-rose-500/20 font-bold text-rose-100'
          : line.reply?.type === 'hint'
            ? 'bg-amber-400/15 text-amber-200'
            : 'text-slate-300'
    items.push(
      <li key={index} className={`animate-pop rounded-xl px-4 py-2 ${tone}`}>
        {line.reply?.type === 'hint' && '💡 '}
        {line.text}
      </li>
    )
  })

  return (
    <ol className="flex flex-col gap-2">
      {items}
      <div ref={end} />
    </ol>
  )
}

import { MAX_QUESTIONS } from '../shared/replies'
import { GameView } from './useGame'
import { VERDICT_STYLES } from './Verdict'

/** One dot per question, colored by its answer */
export default function Progress({ game }: { game: GameView }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <p className="text-sm text-slate-400">
        Question{' '}
        <span className="font-bold text-slate-100">
          {Math.min(game.count, MAX_QUESTIONS)}
        </span>{' '}
        of {MAX_QUESTIONS}
      </p>
      <div className="flex gap-1" aria-hidden>
        {Array.from({ length: MAX_QUESTIONS }, (_, index) => {
          const answer = game.answers[index]
          const found = game.end?.type === 'won' && index === game.count - 1
          return (
            <span
              key={index}
              className={`h-3 w-3 rounded-full ${
                found
                  ? 'bg-emerald-300 ring-2 ring-emerald-100'
                  : answer
                    ? VERDICT_STYLES[answer.verdict].className
                    : 'bg-white/10'
              }`}
            />
          )
        })}
      </div>
    </div>
  )
}

import { useLang } from '../store/hooks'
import { TEXT } from './text'

interface CommandmentsProps {
  /** What the people carved, in the order they carved it. */
  commandments: string[]
}

/**
 * The scripture.
 *
 * These are the user's own sentences, shortened and hardened by people who were
 * not in the room when they were said. Nothing on screen is funnier than your
 * own words carved into stone, so they stay up for the rest of the call.
 */
export default function Commandments({ commandments }: CommandmentsProps) {
  const lang = useLang()
  if (!commandments.length) return null

  return (
    <div className="pointer-events-none absolute right-8 top-8 flex w-56 flex-col gap-3">
      <span className="text-[10px] uppercase tracking-[0.28em] text-[#7d6a52]">
        {TEXT[lang].scripture}
      </span>
      {commandments.map((text, index) => (
        <p
          key={text}
          className="animate-carve border-l border-[#c69a5c]/40 pl-3 text-[13px] leading-snug tracking-widest text-[#e8d3ae]"
          style={{ animationDelay: `${index * 80}ms` }}
        >
          {text}
        </p>
      ))}
    </div>
  )
}

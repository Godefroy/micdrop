import { Robot as RobotState } from '../game/Game'
import { EMOJI, Entity } from '../game/world'
import { at } from './Garden'

const EYES = {
  up: { x: 0, y: -3 },
  down: { x: 0, y: 3 },
  left: { x: -4, y: 0 },
  right: { x: 4, y: 0 },
}

const LIGHT = {
  neutral: '#7dd3fc',
  happy: '#86efac',
  sad: '#93c5fd',
  confused: '#fcd34d',
  sleepy: '#c4b5fd',
}

const TRICKS = {
  dance: 'animate-dance',
  spin: 'animate-spin-once',
  jump: 'animate-jump',
  wave: 'animate-jump',
  chop: 'animate-dance',
}

/** Bip, seen from above: its eyes look where it goes, its light shows its mood */
export default function Robot({
  robot,
  held,
}: {
  robot: RobotState
  held?: Entity
}) {
  const eyes = EYES[robot.facing]
  const mouth = {
    neutral: 'M 42 62 Q 50 66 58 62',
    happy: 'M 38 60 Q 50 74 62 60',
    sad: 'M 40 68 Q 50 58 60 68',
    confused: 'M 40 64 L 60 62',
    sleepy: 'M 44 64 L 56 64',
  }[robot.mood]

  return (
    <div className="tile glide z-20" style={at(robot.x, robot.y)}>
      <div
        className={`relative h-full w-full ${robot.trick ? TRICKS[robot.trick] : ''}`}
      >
        <svg viewBox="0 0 100 100" className="h-full w-full drop-shadow-lg">
          {/* Antenna */}
          <line
            x1="50"
            y1="14"
            x2="50"
            y2="4"
            stroke="#475569"
            strokeWidth="4"
          />
          <circle cx="50" cy="5" r="6" fill={LIGHT[robot.mood]}>
            <animate
              attributeName="opacity"
              values="1;0.4;1"
              dur="1.2s"
              repeatCount="indefinite"
            />
          </circle>
          {/* Arms */}
          <rect
            x="4"
            y="42"
            width="14"
            height="26"
            rx="7"
            fill="#94a3b8"
            transform={robot.trick === 'wave' ? 'rotate(-40 11 42)' : undefined}
          />
          <rect x="82" y="42" width="14" height="26" rx="7" fill="#94a3b8" />
          {/* Body */}
          <rect
            x="14"
            y="14"
            width="72"
            height="72"
            rx="24"
            fill="#e2e8f0"
            stroke="#64748b"
            strokeWidth="3"
          />
          <rect x="24" y="26" width="52" height="46" rx="16" fill="#1e293b" />
          {/* Eyes */}
          {robot.mood === 'sleepy' ? (
            <>
              <line
                x1={34 + eyes.x}
                y1={44}
                x2={44 + eyes.x}
                y2={44}
                stroke="#a5f3fc"
                strokeWidth="4"
                strokeLinecap="round"
              />
              <line
                x1={56 + eyes.x}
                y1={44}
                x2={66 + eyes.x}
                y2={44}
                stroke="#a5f3fc"
                strokeWidth="4"
                strokeLinecap="round"
              />
            </>
          ) : (
            <>
              <circle cx={39 + eyes.x} cy={44 + eyes.y} r="6" fill="#a5f3fc" />
              <circle cx={61 + eyes.x} cy={44 + eyes.y} r="6" fill="#a5f3fc" />
            </>
          )}
          <path
            d={mouth}
            stroke="#a5f3fc"
            strokeWidth="4"
            fill="none"
            strokeLinecap="round"
          />
        </svg>

        {held && (
          <span className="absolute -top-[45%] left-1/2 -translate-x-1/2 text-[3cqw] drop-shadow">
            {EMOJI[held.kind]}
          </span>
        )}
      </div>

      {robot.bubble && (
        <div
          key={robot.bubble}
          className="animate-pop-in absolute bottom-[115%] left-1/2 z-40 w-max max-w-[24cqw] rounded-2xl bg-white px-[1.2cqw] py-[0.6cqw] text-center text-[1.4cqw] font-semibold text-slate-800 shadow-lg"
        >
          {robot.bubble}
          <span className="absolute -bottom-[0.6cqw] left-1/2 h-[1.2cqw] w-[1.2cqw] -translate-x-1/2 rotate-45 bg-white" />
        </div>
      )}
    </div>
  )
}

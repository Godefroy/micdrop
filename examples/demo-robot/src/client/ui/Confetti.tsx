const PIECES = Array.from({ length: 60 }, (_, index) => ({
  left: (index * 37) % 100,
  delay: (index % 12) * 0.25,
  duration: 2.5 + (index % 5) * 0.4,
  emoji: ['🎉', '⭐', '🎊', '✨', '💚'][index % 5],
}))

/** Rains down once every quest is done */
export default function Confetti() {
  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {PIECES.map((piece, index) => (
        <span
          key={index}
          className="absolute top-0 text-2xl"
          style={{
            left: `${piece.left}%`,
            animation: `confetti ${piece.duration}s linear ${piece.delay}s infinite`,
          }}
        >
          {piece.emoji}
        </span>
      ))}
    </div>
  )
}

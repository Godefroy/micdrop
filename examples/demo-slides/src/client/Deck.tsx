import { useEffect, useRef } from 'react'
import SlideSkeleton from './slides/SlideSkeleton'
import SlideView from './slides/SlideView'
import { DeckState } from './useDeck'

/**
 * The slides, with what Jev announced on top of them: placeholders for the
 * new ones, a shimmer on the ones being edited, the ones being deleted faded.
 */
export default function Deck({ deck }: { deck: DeckState }) {
  const { slides, pending } = deck
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (pending?.adds.length) {
      end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [pending])

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 2xl:grid-cols-3">
      {slides.map((slide, index) => {
        const editing = pending?.edits.includes(slide.id)
        const deleting = pending?.deletes.includes(slide.id)
        return (
          <Card key={slide.id} number={index + 1}>
            <div
              className={`relative overflow-hidden rounded-xl ring-1 ring-white/10 transition-opacity ${
                deleting ? 'opacity-30 ring-rose-500' : ''
              }`}
            >
              <SlideView slide={slide} />
              {editing && (
                <div className="shimmer absolute inset-0 flex items-center justify-center">
                  <span className="rounded-full bg-black/60 px-3 py-1 text-xs">
                    Updating
                  </span>
                </div>
              )}
            </div>
          </Card>
        )
      })}

      {pending?.adds.map((layout, index) => (
        <Card key={`pending-${index}`} number={slides.length + index + 1}>
          <div className="animate-pop overflow-hidden rounded-xl ring-1 ring-amber-400/40">
            <SlideSkeleton layout={layout} />
          </div>
          <span className="text-xs text-amber-300">{layout}</span>
        </Card>
      ))}
      <div ref={end} />
    </div>
  )
}

function Card({
  number,
  children,
}: {
  number: number
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-slate-500">{number}</span>
      {children}
    </div>
  )
}

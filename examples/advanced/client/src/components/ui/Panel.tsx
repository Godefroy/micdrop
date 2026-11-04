import { ReactNode, useState } from 'react'
import { PiCaretDownBold } from 'react-icons/pi'

interface PanelProps {
  title: string
  /** Marks the panel in the rail, from the one icon family of the demo */
  icon?: ReactNode
  description?: string
  /** Sits before the title, for the switch that turns the panel's job on */
  lead?: ReactNode
  /** Sits at the end of the header, whether the panel is open or not */
  aside?: ReactNode
  /** A word about what the panel is doing right now */
  note?: string
  /** Folds the body away behind the header */
  collapsible?: boolean
  defaultOpen?: boolean
  /** Dims the panel, for a job that is switched off */
  muted?: boolean
  className?: string
  children: ReactNode
}

/**
 * The one container of the demo.
 *
 * Every card used to redeclare its own border, radius and shadow, which is how
 * a settings rail ends up with five slightly different boxes. There is one box
 * now, and what changes between two panels is what they hold.
 *
 * A collapsible header keeps its switch outside the fold button rather than
 * inside it, so neither control swallows the other's clicks or its keyboard.
 */
export default function Panel({
  title,
  icon,
  description,
  lead,
  aside,
  note,
  collapsible,
  defaultOpen = false,
  muted,
  className = '',
  children,
}: PanelProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const isBodyShown = !collapsible || isOpen

  const heading = (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
      <span className="flex items-center gap-2">
        {icon && (
          <span aria-hidden="true" className="text-accent-ink">
            {icon}
          </span>
        )}
        <span className="text-sm font-semibold text-main">{title}</span>
        {note && (
          <span className="rounded-lg bg-accent-soft px-2 py-0.5 text-xs text-accent-ink">
            {note}
          </span>
        )}
      </span>
      {description && (
        <span className="text-xs leading-relaxed text-faint">
          {description}
        </span>
      )}
    </span>
  )

  return (
    <section
      className={`rounded-xl border border-line bg-panel shadow-(--shadow-panel)
        transition-opacity duration-150 ease-rise ${muted ? 'opacity-60' : ''} ${className}`}
    >
      <div className="flex items-start gap-3 p-4">
        {lead}
        {collapsible ? (
          <button
            type="button"
            className="flex min-w-0 flex-1 items-start gap-3 rounded-lg text-left"
            aria-expanded={isOpen}
            onClick={() => setIsOpen((open) => !open)}
          >
            {heading}
            <span className="flex items-center gap-3 pt-0.5">
              {aside}
              <PiCaretDownBold
                aria-hidden="true"
                className={`h-3 w-3 shrink-0 text-faint transition-transform duration-150 ease-rise ${
                  isOpen ? 'rotate-180' : ''
                }`}
              />
            </span>
          </button>
        ) : (
          <>
            {heading}
            {aside && (
              <span className="flex items-center gap-3 pt-0.5">{aside}</span>
            )}
          </>
        )}
      </div>
      {isBodyShown && (
        <div className="flex flex-col gap-4 border-t border-line p-4">
          {children}
        </div>
      )}
    </section>
  )
}

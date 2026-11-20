import { ReactNode, useState } from 'react'
import { PiCaretDownBold } from 'react-icons/pi'

interface GroupProps {
  title: string
  description?: string
  /** Folds the body away behind the title */
  collapsible?: boolean
  defaultOpen?: boolean
  /** Draws the rule that separates this subject from the one above it */
  className?: string
  children: ReactNode
}

/**
 * One subject inside a panel.
 *
 * Everything the client sends to the server belongs in one panel, which is
 * several separate subjects: what runs the call, how the agent behaves, and
 * where the turns are weighed. Groups keep them apart without turning one
 * panel into several, and the ones read less often fold away.
 */
export default function Group({
  title,
  description,
  collapsible,
  defaultOpen = false,
  className = '',
  children,
}: GroupProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const isBodyShown = !collapsible || isOpen

  const heading = (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
      <h3 className="text-xs font-semibold text-dim">{title}</h3>
      {description && (
        <span className="text-xs leading-relaxed text-faint">
          {description}
        </span>
      )}
    </span>
  )

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {collapsible ? (
        <button
          type="button"
          className="flex cursor-pointer items-start gap-3 rounded-lg text-left"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((open) => !open)}
        >
          {heading}
          <PiCaretDownBold
            aria-hidden="true"
            className={`mt-0.5 h-3 w-3 shrink-0 text-faint transition-transform duration-150 ease-rise ${
              isOpen ? 'rotate-180' : ''
            }`}
          />
        </button>
      ) : (
        heading
      )}
      {isBodyShown && children}
    </div>
  )
}

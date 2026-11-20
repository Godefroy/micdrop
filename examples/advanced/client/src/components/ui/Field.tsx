import { ReactNode } from 'react'

interface FieldProps {
  label: string
  /** Points the label at the control it names */
  htmlFor?: string
  children: ReactNode
}

/**
 * One labelled setting, the label above its control. A stack of them reads as
 * a short form rather than as a table of selects, and the control keeps the
 * full width of the panel.
 */
export default function Field({ label, htmlFor, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-xs text-dim">
        {label}
      </label>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {children}
      </div>
    </div>
  )
}

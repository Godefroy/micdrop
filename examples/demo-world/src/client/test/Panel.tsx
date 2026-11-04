import { ReactNode } from 'react'

/** The handful of primitives every test panel is built from. */

/**
 * Separates the bench into zones, so a long scroll of sections reads as a few
 * things rather than fourteen.
 */
export function Group({ title }: { title: string }) {
  return (
    <h2 className="border-b border-white/10 bg-white/3 px-4 py-2 text-[10px] font-medium uppercase tracking-[0.22em] text-[#9d9ab5]">
      {title}
    </h2>
  )
}

export function Section({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="border-b border-white/10 px-4 py-3">
      <h3 className="mb-2 text-[10px] uppercase tracking-[0.2em] text-[#6f6c85]">
        {title}
      </h3>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  )
}

export function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-1.5">{children}</div>
}

export function TestButton({
  label,
  onClick,
  active,
}: {
  label: string
  onClick: () => void
  active?: boolean
}) {
  return (
    <button
      type="button"
      tabIndex={0}
      aria-label={label}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onClick()
      }}
      className={[
        'rounded-sm border px-2 py-1 text-xs transition',
        active
          ? 'border-[#9db8ff]/60 bg-[#9db8ff]/15 text-[#dbe6ff]'
          : 'border-white/10 bg-white/5 text-[#b6b3c8] hover:border-white/30 hover:text-white',
      ].join(' ')}
    >
      {label}
    </button>
  )
}

export function Slider({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  onChange,
}: {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (value: number) => void
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-[#b6b3c8]">
      <span className="w-20 shrink-0 text-[#8d8aa0]">{label}</span>
      <input
        type="range"
        className="h-1 flex-1 accent-[#9db8ff]"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="w-10 shrink-0 text-right tabular-nums">
        {value.toFixed(2)}
      </span>
    </label>
  )
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-[#b6b3c8]">
      <input
        type="checkbox"
        className="accent-[#9db8ff]"
        checked={checked}
        aria-label={label}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  )
}

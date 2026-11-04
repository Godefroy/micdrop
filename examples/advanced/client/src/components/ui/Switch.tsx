interface SwitchProps {
  label: string
  /** Keeps the label for screen readers when something else already shows it */
  hideLabel?: boolean
  /** What the setting does, read under the label */
  help?: string
  checked: boolean
  disabled?: boolean
  /** Why the switch cannot be moved, shown on the control itself */
  reason?: string
  onChange: (checked: boolean) => void
}

/**
 * One setting, on or off.
 *
 * A real checkbox does the work and stays reachable by keyboard, the track is
 * what gets drawn. Everything the demo used to hide behind a `title` is now
 * written under the label, because the point of the page is to say what each
 * of these does.
 */
export default function Switch({
  label,
  hideLabel,
  help,
  checked,
  disabled,
  reason,
  onChange,
}: SwitchProps) {
  return (
    <label
      className={`flex items-start ${hideLabel && !help ? '' : 'gap-3'} ${
        disabled ? 'cursor-not-allowed' : 'cursor-pointer'
      }`}
      title={reason}
    >
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span
        aria-hidden="true"
        className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full bg-line-strong
          transition-colors duration-150 ease-rise
          after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4
          after:rounded-full after:bg-knob after:transition-transform
          after:duration-150 after:ease-rise
          peer-checked:bg-accent peer-checked:after:translate-x-4
          peer-focus-visible:outline-solid peer-focus-visible:outline-2
          peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent
          peer-disabled:opacity-50"
      />
      <span className={`min-w-0 ${disabled ? 'opacity-60' : ''}`}>
        <span className={hideLabel ? 'sr-only' : 'block text-sm text-main'}>
          {label}
        </span>
        {help && (
          <span className="mt-0.5 block text-xs leading-relaxed text-faint">
            {help}
          </span>
        )}
      </span>
    </label>
  )
}

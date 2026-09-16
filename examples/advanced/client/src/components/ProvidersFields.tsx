import { useMicdropState } from '@micdrop/react'
import { useRef } from 'react'
import {
  CallMode,
  LANGUAGE_OPTIONS,
  MODE_PARTS,
  MODES,
  PART_LABELS,
  ProviderInfo,
  Selection,
  useProviders,
} from '../providers'
import Field from './ui/Field'
import Select from './ui/Select'

/**
 * What runs the call: the language it is held in, and one provider per part,
 * or a single realtime model.
 *
 * The catalog comes from the server, so a provider whose API key is missing,
 * or whose local model is not installed, appears greyed out rather than
 * failing once the call has started.
 */
export default function ProvidersFields() {
  const { isStarted } = useMicdropState()
  const {
    catalog,
    error,
    lang,
    selectLang,
    mode,
    selectMode,
    selections,
    select,
  } = useProviders()

  return (
    <div className="flex flex-col gap-3">
      <ModeTabs mode={mode} disabled={isStarted} onChange={selectMode} />

      {error && (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs leading-relaxed text-danger">
          {error}
        </p>
      )}
      {!error && !catalog && (
        <p className="text-xs text-faint">
          Reading the catalog from the server…
        </p>
      )}

      <Field label="Language">
        <Select
          className="w-full"
          value={lang}
          disabled={isStarted}
          aria-label="Language"
          onChange={(event) => selectLang(event.target.value)}
        >
          {LANGUAGE_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>

      {catalog &&
        MODE_PARTS[mode].map((part) => (
          <PartRow
            key={part}
            label={PART_LABELS[part]}
            providers={catalog[part].providers}
            selection={selections[part]}
            disabled={isStarted}
            onChange={(selection) => select(part, selection)}
          />
        ))}

      {mode === 'realtime' && (
        <p className="text-xs leading-relaxed text-faint">
          One model hears the user and answers with its own voice, in place of
          an agent, a speech to text and a text to speech.
        </p>
      )}
    </div>
  )
}

interface ModeTabsProps {
  mode: CallMode
  disabled: boolean
  onChange: (mode: CallMode) => void
}

/** Pipeline of three providers, or one realtime model */
function ModeTabs({ mode, disabled, onChange }: ModeTabsProps) {
  const tabsRef = useRef<Array<HTMLButtonElement | null>>([])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const index = MODES.findIndex((item) => item.id === mode)
    const step = event.key === 'ArrowRight' ? 1 : -1
    const next = (index + step + MODES.length) % MODES.length
    onChange(MODES[next].id)
    tabsRef.current[next]?.focus()
  }

  return (
    <div
      role="tablist"
      aria-label="How the call runs"
      className="grid grid-cols-2 gap-1 rounded-lg border border-line bg-inset p-1"
    >
      {MODES.map((item, index) => {
        const selected = item.id === mode
        const handleClick = () => onChange(item.id)
        return (
          <button
            key={item.id}
            ref={(element) => {
              tabsRef.current[index] = element
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={handleClick}
            onKeyDown={handleKeyDown}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors
              duration-150 ease-rise disabled:cursor-not-allowed ${
                selected
                  ? 'bg-raised text-main shadow-sm'
                  : 'text-dim hover:text-main disabled:hover:text-dim'
              }`}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

interface PartRowProps {
  label: string
  providers: ProviderInfo[]
  selection: Selection
  disabled: boolean
  onChange: (selection: Selection) => void
}

/** One part of the call, and the model the chosen provider runs it with */
function PartRow({
  label,
  providers,
  selection,
  disabled,
  onChange,
}: PartRowProps) {
  const provider = providers.find((item) => item.id === selection.provider)
  const hasModels = provider && provider.models.length > 0

  const handleProvider = (event: React.ChangeEvent<HTMLSelectElement>) => {
    onChange({ provider: event.target.value })
  }

  const handleModel = (event: React.ChangeEvent<HTMLSelectElement>) => {
    onChange({ provider: selection.provider, model: event.target.value })
  }

  return (
    <Field label={label}>
      <Select
        className="w-full"
        value={selection.provider ?? ''}
        disabled={disabled}
        aria-label={label}
        onChange={handleProvider}
      >
        {providers.map((item) => (
          <option
            key={item.id}
            value={item.id}
            disabled={!item.available}
            title={
              item.available
                ? item.description
                : `Missing ${item.missingEnv.join(', ') || 'setup'}`
            }
          >
            {item.label}
            {item.local ? ' (local)' : ''}
            {item.available ? '' : ' (unavailable)'}
          </option>
        ))}
      </Select>

      {hasModels && (
        <Select
          className="w-full"
          value={selection.model ?? ''}
          disabled={disabled}
          aria-label={`${label} model`}
          onChange={handleModel}
        >
          {provider.models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
              {model.language ? ` (${model.language})` : ''}
            </option>
          ))}
        </Select>
      )}
    </Field>
  )
}

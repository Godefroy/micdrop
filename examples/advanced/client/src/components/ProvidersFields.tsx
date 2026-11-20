import { useMicdropState } from '@micdrop/react'
import { useEffect, useRef, useState } from 'react'
import { PiPlayFill, PiStopFill } from 'react-icons/pi'
import {
  CallMode,
  LANGUAGE_OPTIONS,
  MODE_PARTS,
  MODES,
  PART_LABELS,
  ProviderInfo,
  Selection,
  useProviders,
  ModelOption,
  useVoices,
  VoiceOption,
} from '../providers'
import Button from './ui/Button'
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

      {/* The language holds for the whole call, the providers below it */}
      <hr className="my-1 border-line" />

      <ModeTabs mode={mode} disabled={isStarted} onChange={selectMode} />

      {error && (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs leading-relaxed text-danger">
          {error}
        </p>
      )}
      {!error && !catalog && (
        <p className="text-xs text-faint">
          Loading the providers from the server…
        </p>
      )}

      {catalog &&
        MODE_PARTS[mode].map((part) => (
          <PartRow
            key={part}
            label={PART_LABELS[part]}
            providers={catalog[part].providers}
            selection={selections[part]}
            lang={lang}
            disabled={isStarted}
            onChange={(selection) => select(part, selection)}
          />
        ))}

      {mode === 'realtime' && (
        <p className="text-xs leading-relaxed text-faint">
          One model hears you and answers with its own voice, in place of the
          agent, the speech to text and the text to speech.
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
                  ? 'bg-raised text-main shadow-xs'
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
  /** Language of the call, which the voice should speak */
  lang: string
  disabled: boolean
  onChange: (selection: Selection) => void
}

/** One part of the call, and the model the chosen provider runs it with */
function PartRow({
  label,
  providers,
  selection,
  lang,
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

  const handleVoice = (voice: string) => {
    onChange({ ...selection, voice })
  }

  return (
    <Field label={label}>
      {/* The provider and its model read as one choice, so they share a line */}
      <div className="flex w-full min-w-0 gap-2">
        <Select
          className="min-w-0 flex-1"
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
            className="min-w-0 flex-1"
            value={selection.model ?? ''}
            disabled={disabled}
            aria-label={`${label} model`}
            onChange={handleModel}
          >
            {provider.models.map((model) => (
              <option
                key={model.id}
                value={model.id}
                title={describeModel(model)}
              >
                {model.label}
              </option>
            ))}
          </Select>
        )}
      </div>

      {provider?.hasVoices && (
        <VoiceSelect
          label={label}
          provider={provider}
          model={selection.model}
          voice={selection.voice}
          lang={lang}
          disabled={disabled}
          onChange={handleVoice}
        />
      )}
    </Field>
  )
}

interface VoiceSelectProps {
  label: string
  provider: ProviderInfo
  model?: string
  voice?: string
  lang: string
  disabled: boolean
  onChange: (voice: string) => void
}

/**
 * The voices of the chosen provider and model, read from the server once they
 * are picked. Voices of the account come first, then the others by language.
 */
function VoiceSelect({
  label,
  provider,
  model,
  voice,
  lang,
  disabled,
  onChange,
}: VoiceSelectProps) {
  const { voices, error, loading } = useVoices(provider, model, lang)

  // Another language, provider or model: keep the voice while it is in the
  // list and speaks the language, otherwise take the first one that does
  useEffect(() => {
    if (!voices?.length) return
    const next = pickVoice(voices, voice, provider.defaultVoice, lang)
    if (next && next !== voice) onChange(next)
  }, [voices, lang])

  if (error) {
    return (
      <p className="text-xs text-danger">Cannot load the voices: {error}</p>
    )
  }
  if (loading || !voices) {
    return <p className="text-xs text-faint">Loading…</p>
  }

  const selected = voices.find((option) => option.id === voice)

  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    onChange(event.target.value)
  }

  return (
    <div className="flex w-full min-w-0 items-center gap-2">
      <Select
        className="min-w-0 flex-1"
        value={voice ?? ''}
        disabled={disabled}
        aria-label={`${label} voice`}
        title={selected ? describeVoice(selected) : undefined}
        onChange={handleChange}
      >
        {groupVoices(voices).map(([group, options]) => (
          <optgroup key={group} label={`${group} (${options.length})`}>
            {options.map((option) => (
              <option
                key={option.id}
                value={option.id}
                title={describeVoice(option)}
              >
                {option.label}
                {option.gender ? ` · ${option.gender}` : ''}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
      {selected?.previewUrl && <PreviewButton url={selected.previewUrl} />}
    </div>
  )
}

/** Plays the sample of the selected voice */
function PreviewButton({ url }: { url: string }) {
  const audioRef = useRef<HTMLAudioElement | undefined>(undefined)
  const [playing, setPlaying] = useState(false)

  // Another voice was picked, or the select went away: stop the sample
  useEffect(() => {
    return () => {
      audioRef.current?.pause()
      setPlaying(false)
    }
  }, [url])

  const handleClick = () => {
    if (playing) {
      audioRef.current?.pause()
      setPlaying(false)
      return
    }
    const audio = new Audio(url)
    audio.onended = () => setPlaying(false)
    audio.onerror = () => setPlaying(false)
    audioRef.current = audio
    setPlaying(true)
    audio.play().catch(() => setPlaying(false))
  }

  return (
    <Button
      size="sm"
      className="shrink-0"
      aria-label={playing ? 'Stop the sample' : 'Listen to a sample'}
      icon={playing ? <PiStopFill /> : <PiPlayFill />}
      onClick={handleClick}
    />
  )
}

/**
 * The voice to keep or to switch to: the current one when it is in the list and
 * its own language is the one of the call, otherwise the first voice native to
 * that language, in the order of the select, the default one first if it is
 * native too. A voice only speaking it with an accent comes last. With no
 * voice of that language at all, the current voice stays, or the default one.
 */
function pickVoice(
  voices: VoiceOption[],
  current: string | undefined,
  defaultVoice: string | undefined,
  lang: string
): string | undefined {
  const inList = voices.find((option) => option.id === current)
  if (inList && isNative(inList, lang)) return inList.id

  const ordered = groupVoices(voices).flatMap(([, options]) => options)
  const preferred = [
    ...ordered.filter((option) => option.id === defaultVoice),
    ...ordered,
  ]
  const match =
    preferred.find((option) => isNative(option, lang, true)) ??
    preferred.find((option) => isNative(option, lang)) ??
    preferred.find((option) => speaks(option, lang))
  if (match) return match.id

  if (inList) return inList.id
  return (voices.find((option) => option.id === defaultVoice) ?? voices[0]).id
}

/** The language a voice is native to: the first it lists */
function nativeLanguage(voice: VoiceOption): string | undefined {
  return voice.language ?? voice.languages?.[0]
}

/**
 * Whether a voice is native to a language: the same locale when `exact`, the
 * same language otherwise. A voice declaring no language reads them all.
 */
function isNative(voice: VoiceOption, lang: string, exact = false): boolean {
  const native = nativeLanguage(voice)
  if (!native) return !exact
  return exact
    ? native.toLowerCase() === lang.toLowerCase()
    : sameBase(native, lang)
}

/** Whether a voice speaks a language at all, with an accent included */
function speaks(voice: VoiceOption, lang: string): boolean {
  const languages = voice.language ? [voice.language] : voice.languages
  if (!languages?.length) return true
  return languages.some((code) => sameBase(code, lang))
}

/** Compares locales on their language only, so "es" matches "es-ES" */
function sameBase(a: string, b: string): boolean {
  return a.split('-')[0].toLowerCase() === b.split('-')[0].toLowerCase()
}

/** The voices of the account first, then one group per language */
function groupVoices(voices: VoiceOption[]): Array<[string, VoiceOption[]]> {
  const groups = new Map<string, VoiceOption[]>()
  for (const voice of voices) {
    const group = voice.custom
      ? 'Your voices'
      : (voice.language ?? voice.languages?.[0] ?? 'Every language')
    groups.set(group, [...(groups.get(group) ?? []), voice])
  }
  return [...groups.entries()].sort(([a], [b]) => {
    if (a === 'Your voices') return -1
    if (b === 'Your voices') return 1
    return a.localeCompare(b)
  })
}

/**
 * What the tooltip of a model says, the select itself showing its name alone:
 * its description, whether it reasons, its retirement, its aliases
 */
function describeModel(model: ModelOption): string | undefined {
  const retiring = model.deprecated
    ? `Retiring${model.shutdownDate ? ` on ${model.shutdownDate}` : ''}`
    : undefined
  const aliases = model.aliases?.length
    ? `Also called ${model.aliases.join(', ')}`
    : undefined
  return (
    [
      model.description,
      model.language && `Speaks ${model.language}`,
      model.reasoning && 'Can reason before answering',
      retiring,
      aliases,
    ]
      .filter(Boolean)
      .join('. ') || undefined
  )
}

/** What the tooltip of a voice says: its description and its languages */
function describeVoice(voice: VoiceOption): string {
  const languages = voice.languages?.length
    ? `Speaks ${voice.languages.join(', ')}`
    : undefined
  return [voice.description, languages].filter(Boolean).join('. ')
}

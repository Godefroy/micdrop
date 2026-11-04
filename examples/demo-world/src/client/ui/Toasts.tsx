import { useEffect } from 'react'
import { achievementLabel } from '../../shared/achievements'
import { Lang } from '../../shared/lang'
import { useLang } from '../store/hooks'
import { Toast, worldStore } from '../store/WorldStore'
import { TEXT } from './text'

interface ToastsProps {
  toasts: Toast[]
}

/**
 * Named after the fact, never announced in advance, so a mistake becomes a
 * memory rather than a task that was ticked off. No sound, no fanfare.
 */
/** Never more than two at a time, so they stay a whisper over her body. */
const VISIBLE = 2

function label(toast: Toast, lang: Lang): string {
  if (toast.kind === 'achievement') return achievementLabel(toast.key, lang)
  if (toast.kind === 'commandment') return TEXT[lang].carved
  return TEXT[lang].sensed[toast.key] ?? toast.key
}

export default function Toasts({ toasts }: ToastsProps) {
  const lang = useLang()
  const shown = toasts.slice(0, VISIBLE)

  useEffect(() => {
    if (!shown.length) return
    // Only what is on screen is on a timer, so the rest queue up behind it
    // instead of all expiring together.
    const timers = shown.map((toast, index) =>
      setTimeout(() => worldStore.dismissToast(toast.id), 3200 + index * 600)
    )
    return () => timers.forEach(clearTimeout)
  }, [shown.map((toast) => toast.id).join()])

  if (!shown.length) return null

  return (
    <div className="pointer-events-none absolute inset-x-0 top-8 flex flex-col items-center gap-2">
      {shown.map((toast) => (
        <div
          key={toast.id}
          className="animate-rise rounded-full border border-white/10 bg-black/40 px-4 py-1.5 text-sm text-[#e5e1f0] backdrop-blur-xs"
        >
          {label(toast, lang)}
        </div>
      ))}
    </div>
  )
}

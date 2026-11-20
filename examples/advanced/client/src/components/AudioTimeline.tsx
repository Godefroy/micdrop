import { Mic, Speaker } from '@micdrop/web'
import { useEffect, useRef } from 'react'
import { formatWait, ReplyLatency } from '../hooks/useReplyLatency'
import { useTheme } from '../theme'

interface Props {
  /** The waits measured so far, drawn where they happened */
  measures: ReplyLatency[]
  /** When the caller stopped speaking, while the answer has yet to be heard */
  pendingSince?: number
  /** The microphone is being heard, so the caller keeps a rail of their own */
  isUserLive: boolean
  /** The answer is being played */
  isAssistantLive: boolean
}

// One column of the strip, what it is worth in time and what it takes on screen
const STEP = 40 // ms
const PITCH = 4 // px
const BAR = 2.5 // px

// Levels arrive in decibels below zero. Anything under the floor is silence,
// and the top of the band follows the loudest moment of the last few seconds,
// so a quiet microphone fills the strip as well as a loud one.
const FLOOR = -68
const CEILING_MIN = -45
const CEILING_MAX = -16
const CEILING_DECAY = 6 // dB per second
// Levels are drawn on a curve rather than straight, which keeps the hum of a
// room down near the rail and leaves the band to the voice
const CURVE = 1.5

// How fast a band rises to a level, and how slowly it falls back from it, so a
// syllable reads as one movement instead of a flicker
const ATTACK = 0.55
const RELEASE = 0.22

const PAD = 10 // px kept clear above and below the two bands
const CENTER_GAP = 3 // px between the rail and the foot of a bar
const FADE = 48 // px over which the oldest audio disappears
const STUB = 1.5 // px of bar left standing where a live band hears nothing

/** A wait shorter than this is not worth annotating, the answer was immediate */
const MIN_WAIT = 120 // ms

const LABEL_FONT = '600 10px ui-sans-serif, system-ui, sans-serif'
const VALUE_FONT =
  '600 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

/**
 * The call as it sounds, second after second.
 *
 * The strip scrolls right to left at a fixed pace, the caller above the rail
 * and the assistant below it, in the two colours the demo already gives them.
 * Laying the two voices on one timeline makes the thing that matters in a
 * voice agent visible on its own: the gap between the end of a turn and the
 * answer, which is drawn where it happened and labelled with what it cost.
 */
export default function AudioTimeline({
  measures,
  pendingSince,
  isUserLive,
  isAssistantLive,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { theme } = useTheme()

  // What the drawing loop reads, refreshed after every render so the loop
  // never works from a call state that has moved on
  const liveRef = useRef({ measures, pendingSince, isUserLive, isAssistantLive })
  useEffect(() => {
    liveRef.current = { measures, pendingSince, isUserLive, isAssistantLive }
  })

  // The audio already drawn, kept across a theme switch so changing mode does
  // not wipe the last seconds of the call
  const columnsRef = useRef<Column[]>([])
  const userRef = useRef<Band>({ ceiling: CEILING_MIN, shown: 0 })
  const assistantRef = useRef<Band>({ ceiling: CEILING_MIN, shown: 0 })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const canvasContext = canvas.getContext('2d')
    if (!canvasContext) return
    // Narrowed once here, so the drawing below never has to ask again
    const context = canvasContext

    const colors = readColors()
    const hasRoundRect = typeof context.roundRect === 'function'
    let width = 0
    let height = 0
    let nextColumn = 0

    const resize = () => {
      const ratio = window.devicePixelRatio || 1
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
    }

    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    resize()

    /** Adds the columns owed since the last frame, on a grid the drawing shares */
    const sample = (now: number) => {
      // A tab that was in the background owes minutes of audio nobody heard
      if (nextColumn === 0 || now - nextColumn > 1000) nextColumn = now

      const columns = columnsRef.current
      const { isUserLive, isAssistantLive } = liveRef.current
      while (nextColumn <= now) {
        columns.push({
          time: nextColumn,
          user: measureBand(userRef.current, Mic.volume, isUserLive),
          assistant: measureBand(
            assistantRef.current,
            Speaker.volume,
            isAssistantLive
          ),
        })
        nextColumn += STEP
      }

      const kept = Math.ceil(width / PITCH) + 2
      if (columns.length > kept) columns.splice(0, columns.length - kept)
    }

    const draw = (now: number) => {
      const columns = columnsRef.current
      const centerY = Math.round(height / 2)
      const maxBar = Math.max(4, centerY - PAD - CENTER_GAP)
      const rail = centerY + 0.5

      context.clearRect(0, 0, width, height)

      // The rail the two voices sit on
      context.lineWidth = 1
      context.strokeStyle = rgba(colors.line, 1)
      context.beginPath()
      context.moveTo(0, rail)
      context.lineTo(width, rail)
      context.stroke()

      drawBand('user', -1, colors.accent)
      drawBand('assistant', 1, colors.voice)

      const tail = columns.length ? columns[columns.length - 1].time : now
      for (const measure of liveRef.current.measures) {
        drawWait(measure.from, measure.to, false)
      }
      const pending = liveRef.current.pendingSince
      if (pending !== undefined && now - pending > MIN_WAIT) {
        drawWait(pending, now, true)
      }

      // The oldest audio leaves rather than being cut off at the edge
      const fade = context.createLinearGradient(0, 0, FADE, 0)
      fade.addColorStop(0, rgba(colors.inset, 1))
      fade.addColorStop(1, rgba(colors.inset, 0))
      context.fillStyle = fade
      context.fillRect(0, 0, FADE, height)

      context.font = LABEL_FONT
      context.textAlign = 'left'
      context.fillStyle = rgba(colors.faint, 0.85)
      context.textBaseline = 'top'
      context.fillText('You', 8, PAD - 4)
      context.textBaseline = 'bottom'
      context.fillText('Assistant', 8, height - PAD + 4)

      /** One voice, as a row of bars growing away from the rail */
      function drawBand(key: 'user' | 'assistant', side: 1 | -1, color: Rgb) {
        const gradient = context.createLinearGradient(
          0,
          centerY,
          0,
          centerY + side * (maxBar + CENTER_GAP)
        )
        gradient.addColorStop(0, rgba(color, 0.35))
        gradient.addColorStop(1, rgba(color, 1))
        context.fillStyle = gradient
        context.beginPath()

        for (let index = columns.length - 1; index >= 0; index--) {
          const age = columns.length - 1 - index
          const x = width - (age + 1) * PITCH + (PITCH - BAR) / 2
          if (x + BAR < 0) break

          const value = columns[index][key]
          if (value <= 0) continue
          const bar = Math.max(STUB, value * maxBar)
          const y = side < 0 ? centerY - CENTER_GAP - bar : centerY + CENTER_GAP
          if (hasRoundRect) {
            context.roundRect(x, y, BAR, bar, BAR / 2)
          } else {
            context.rect(x, y, BAR, bar)
          }
        }

        context.fill()
      }

      /** Where a moment of the call sits on the strip */
      function xForTime(time: number): number {
        const age = (tail - time) / STEP
        return width - (age + 1) * PITCH + PITCH / 2
      }

      /**
       * A silence the caller sat through, bracketed and priced.
       *
       * The one still running is amber and grows with every frame, which is
       * the whole reading: the number stops moving when the answer is heard.
       */
      function drawWait(from: number, to: number, isPending: boolean) {
        const right = Math.min(xForTime(to), width - 1)
        if (right < 6) return
        const left = xForTime(from)
        if (left > width) return

        const tint = isPending ? colors.warn : colors.faint
        const ink = isPending ? colors.warn : colors.dim

        if (isPending) {
          context.fillStyle = rgba(colors.warn, 0.08)
          context.fillRect(left, PAD, right - left, height - PAD * 2)
        }

        // Where the turn ended and where the answer began
        context.save()
        context.setLineDash([2, 3])
        context.lineWidth = 1
        context.strokeStyle = rgba(tint, 0.7)
        context.beginPath()
        for (const x of [left, right]) {
          context.moveTo(Math.round(x) + 0.5, PAD)
          context.lineTo(Math.round(x) + 0.5, height - PAD)
        }
        context.stroke()
        context.restore()

        // The bridge between the two, which is the wait itself
        context.strokeStyle = rgba(tint, 0.9)
        context.lineWidth = 1
        context.beginPath()
        context.moveTo(left, rail)
        context.lineTo(right, rail)
        context.stroke()

        // A counter that jumps by the millisecond is unreadable, so a wait
        // still running is rounded to the nearest hundredth of a second
        const elapsed = to - from
        const text = formatWait(
          isPending ? Math.round(elapsed / 10) * 10 : elapsed
        )
        context.font = VALUE_FONT
        const pillWidth = context.measureText(text).width + 12
        const pillHeight = 15
        const center = clamp(
          (left + right) / 2,
          pillWidth / 2 + 2,
          width - pillWidth / 2 - 2
        )

        context.beginPath()
        const box = [
          center - pillWidth / 2,
          centerY - pillHeight / 2,
          pillWidth,
          pillHeight,
        ] as const
        if (hasRoundRect) {
          context.roundRect(...box, pillHeight / 2)
        } else {
          context.rect(...box)
        }
        context.fillStyle = rgba(colors.inset, 0.94)
        context.fill()
        context.strokeStyle = rgba(tint, 0.55)
        context.stroke()

        context.fillStyle = rgba(ink, 1)
        context.textAlign = 'center'
        context.textBaseline = 'middle'
        context.fillText(text, center, rail)
      }
    }

    let frame = requestAnimationFrame(function tick(now) {
      frame = requestAnimationFrame(tick)
      sample(now)
      draw(now)
    })

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [theme])

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-inset">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Live audio of the call. Your voice is above the line and the assistant's below it. A label between the two shows the wait before each answer."
        className="block h-20 w-full sm:h-24"
      />
    </div>
  )
}

/** One column of the strip: when it was heard, and how loud each side was */
interface Column {
  time: number
  user: number
  assistant: number
}

/** What one voice is doing, between two readings of its level */
interface Band {
  /** The level the top of the band is worth right now, in decibels */
  ceiling: number
  /** The height being drawn, between 0 and 1 */
  shown: number
}

/**
 * Turns a level in decibels into the height of one bar.
 *
 * The ceiling follows the loudest recent moment and slides back down on its
 * own, so the band is read against the voice in the room rather than against a
 * number picked in advance for some other microphone.
 * @param band - The state of that voice, moved forward by one column
 * @param volume - The level just measured, in decibels below zero
 * @param isLive - That voice is being heard, so its rail stays drawn
 * @returns The height of the bar, between 0 and 1
 */
function measureBand(band: Band, volume: number, isLive: boolean): number {
  const ceiling = clamp(
    Math.max(volume, band.ceiling - (CEILING_DECAY * STEP) / 1000),
    CEILING_MIN,
    CEILING_MAX
  )
  band.ceiling = ceiling

  const target =
    isLive && Number.isFinite(volume)
      ? clamp((volume - FLOOR) / (ceiling - FLOOR), 0, 1) ** CURVE
      : 0
  band.shown += (target - band.shown) * (target > band.shown ? ATTACK : RELEASE)

  // A live band keeps a hairline of its own, so the caller can see they are
  // still being heard through a silence
  return isLive ? Math.max(band.shown, 0.001) : band.shown
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

type Rgb = [number, number, number]

interface Colors {
  accent: Rgb
  voice: Rgb
  warn: Rgb
  line: Rgb
  faint: Rgb
  dim: Rgb
  inset: Rgb
}

/**
 * The tokens of the demo, as numbers a canvas can shade.
 *
 * Read once per theme rather than per frame, since asking for a computed style
 * costs a style recalculation.
 */
function readColors(): Colors {
  const style = getComputedStyle(document.documentElement)
  const read = (name: string): Rgb =>
    parseHex(style.getPropertyValue(name).trim())
  return {
    accent: read('--accent'),
    voice: read('--voice'),
    warn: read('--warn'),
    line: read('--line'),
    faint: read('--faint'),
    dim: read('--dim'),
    inset: read('--inset'),
  }
}

/** The demo writes its tokens as `#rrggbb`, which is all this has to read */
function parseHex(value: string): Rgb {
  const hex = value.replace('#', '')
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((character) => character + character)
          .join('')
      : hex
  const number = Number.parseInt(full, 16)
  if (full.length !== 6 || Number.isNaN(number)) return [128, 128, 128]
  return [(number >> 16) & 255, (number >> 8) & 255, number & 255]
}

function rgba([red, green, blue]: Rgb, alpha: number): string {
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

import { useMicVolume, useMicdropState, useSpeakerVolume } from '@micdrop/react'
import { MicdropState } from '@micdrop/web'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'

interface Props {
  size?: number
}

interface Shape {
  label: string
  ring: string
  disc: string
  /** How much of the orb the disc fills, before the voice moves it */
  scale: number
  /** The ring breathes only while the call waits for someone to speak */
  breathing?: boolean
}

/**
 * What the call is doing, as one thing that moves.
 *
 * The colour says who holds the floor, emerald for the caller and sky for the
 * assistant, and the disc follows whichever of the two voices is being heard.
 * A ring that breathes means the call is up and waiting.
 */
export default function CallStatusOrb({ size = 44 }: Props) {
  const state = useMicdropState()
  const { micVolume, maxMicVolume } = useMicVolume()
  const { speakerVolume, maxSpeakerVolume } = useSpeakerVolume()
  const reduced = usePrefersReducedMotion()

  const shape = getShape(state)
  const scale = reduced
    ? shape.scale
    : shape.scale *
      voiceScale(
        state,
        micVolume,
        maxMicVolume,
        speakerVolume,
        maxSpeakerVolume
      )

  return (
    <div
      className="relative grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={shape.label}
    >
      <span
        aria-hidden="true"
        className={`absolute inset-0 rounded-full border ${shape.ring} ${
          shape.breathing && !reduced ? 'animate-breathe' : ''
        }`}
      />
      <span
        aria-hidden="true"
        className={`rounded-full transition-transform duration-100 ease-out ${shape.disc}`}
        style={{
          width: size * 0.5,
          height: size * 0.5,
          transform: `scale(${scale})`,
        }}
      />
    </div>
  )
}

function getShape(state: MicdropState): Shape {
  if (state.error) {
    return {
      label: 'The call stopped on an error',
      ring: 'border-danger',
      disc: 'bg-danger',
      scale: 0.8,
    }
  }
  if (state.isReconnecting) {
    return {
      label: 'Connection lost, trying again',
      ring: 'border-warn',
      disc: 'bg-warn',
      scale: 0.7,
      breathing: true,
    }
  }
  if (state.isProcessing) {
    return {
      label: 'The assistant is thinking',
      ring: 'border-warn',
      disc: 'bg-warn',
      scale: 0.7,
      breathing: true,
    }
  }
  if (state.isAssistantSpeaking) {
    return {
      label: 'The assistant is speaking',
      ring: 'border-voice',
      disc: 'bg-voice',
      scale: 1,
    }
  }
  if (state.isUserSpeaking) {
    return {
      label: 'You are speaking',
      ring: 'border-accent',
      disc: 'bg-accent',
      scale: 1,
    }
  }
  if (state.isMuted) {
    // Red, like the microphone button that turned it off
    return {
      label: 'The microphone is muted',
      ring: 'border-danger',
      disc: 'bg-danger',
      scale: 0.45,
    }
  }
  if (state.isListening) {
    // The microphone can be running on its own, before anyone is called. It
    // hears you either way, so it stays emerald, and only the call breathes.
    return state.isStarted
      ? {
          label: 'Listening',
          ring: 'border-accent',
          disc: 'bg-accent',
          scale: 0.6,
          breathing: true,
        }
      : {
          label: 'The microphone is on',
          ring: 'border-accent',
          disc: 'bg-accent',
          scale: 0.45,
        }
  }
  return {
    label: 'Ready to call',
    ring: 'border-line-strong',
    disc: 'bg-line-strong',
    scale: 0.6,
  }
}

/**
 * How loud the voice holding the floor is, between a fifth of the disc and all
 * of it. Volumes arrive in decibels below zero, so the reading is taken
 * against the loudest one heard so far rather than against a fixed floor.
 */
function voiceScale(
  state: MicdropState,
  micVolume: number,
  maxMicVolume: number,
  speakerVolume: number,
  maxSpeakerVolume: number
): number {
  if (state.isUserSpeaking) return level(micVolume, maxMicVolume)
  if (state.isAssistantSpeaking) return level(speakerVolume, maxSpeakerVolume)
  return 1
}

function level(volume: number, max: number): number {
  return 0.5 + 0.5 * Math.min(1, Math.max(0, (volume + 100) / (max + 100)))
}

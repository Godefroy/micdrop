import {
  useMicVolume,
  useMicdropEndCall,
  useMicdropState,
  useSpeakerVolume,
} from '@micdrop/react'
import { Micdrop, MicdropState, Speaker } from '@micdrop/web'
import {
  PiCircleNotchBold,
  PiPauseFill,
  PiPhoneDisconnectFill,
  PiPlayFill,
  PiWarningBold,
} from 'react-icons/pi'
import { getServerTurnDetection, getVADConfig } from '../detection'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import {
  formatWait,
  ReplyLatency,
  useReplyLatency,
} from '../hooks/useReplyLatency'
import {
  getAutoOptions,
  getLang,
  getMode,
  getPrompt,
  getSelections,
  getToolOptions,
  SERVER_URL,
} from '../providers'
import AudioTimeline from './AudioTimeline'
import CallStatusOrb from './CallStatusOrb'
import Button from './ui/Button'
import Meter from './ui/Meter'

/**
 * The call itself: what it is doing, how it sounds, and the two or three
 * buttons that act on it.
 *
 * It sits under the transcript rather than above it so the newest line, the
 * audio and the button that ends the call are all in the same glance, the way
 * a call is laid out everywhere else.
 */
export default function CallDock() {
  const state = useMicdropState()
  const { isStarted, isMicStarted, isMuted, isPaused, isStarting, error } =
    state

  // Muting and pausing both stop the detectors, so nothing is being heard even
  // though the microphone carries on reporting a level
  const isHeard = isMicStarted && !isMuted && !isPaused
  const { measures, pendingSince } = useReplyLatency()
  const reduced = usePrefersReducedMotion()

  // One button: the microphone is asked for as the call starts
  const handleStart = () => {
    Micdrop.start({
      url: `${SERVER_URL.replace(/^http/, 'ws')}/call`,
      vad: getVADConfig(),
      params: {
        authorization: '1234',
        // Language, providers, agent prompts and tools picked in the rail
        lang: getLang(),
        mode: getMode(),
        providers: getSelections(),
        auto: getAutoOptions(),
        tools: getToolOptions(),
        // The system prompt as the editor shows it
        prompt: getPrompt(),
        // The server weighs the turns when the browser is not doing it
        smartTurn: getServerTurnDetection(),
      },
      // disableInterruption: true,
      debugLog: true,
    })
  }

  useMicdropEndCall(() => {
    console.log('Call ended')

    // Stop after last speech end
    setTimeout(async () => {
      if (Speaker.isPlaying) {
        Speaker.on('StopPlaying', Micdrop.stop)
      } else {
        Micdrop.stop()
      }
    }, 5000)
  })

  return (
    <div className="shrink-0 rounded-xl border border-line bg-panel p-3 shadow-[var(--shadow-dock)]">
      <div className="flex flex-wrap items-center gap-3">
        <CallStatusOrb />

        <div className="flex min-w-0 flex-1 basis-40 flex-col gap-1">
          <span className="text-sm text-main">{statusLine(state)}</span>
          <ReplyLatencyLine measures={measures} />
        </div>

        <div className="flex items-center gap-2">
          {isStarted ? (
            <>
              <Button
                icon={
                  isPaused ? (
                    <PiPlayFill aria-hidden="true" className="h-3.5 w-3.5" />
                  ) : (
                    <PiPauseFill aria-hidden="true" className="h-3.5 w-3.5" />
                  )
                }
                onClick={isPaused ? Micdrop.resume : Micdrop.pause}
              >
                {isPaused ? 'Resume' : 'Pause'}
              </Button>
              <Button
                variant="danger"
                icon={
                  <PiPhoneDisconnectFill
                    aria-hidden="true"
                    className="h-3.5 w-3.5"
                  />
                }
                onClick={Micdrop.stop}
              >
                Stop call
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              // Held until the call is up, the microphone taking a while to
              // open included
              disabled={isStarting}
              aria-busy={isStarting}
              icon={
                isStarting ? (
                  <PiCircleNotchBold
                    aria-hidden="true"
                    className="h-3.5 w-3.5 motion-safe:animate-spin"
                  />
                ) : (
                  <PiPlayFill aria-hidden="true" className="h-3.5 w-3.5" />
                )
              }
              onClick={handleStart}
            >
              {isStarting ? 'Connecting' : 'Start call'}
            </Button>
          )}
        </div>
      </div>

      {/* The microphone can be started from the rail before a call, and what it
          hears is worth watching from the moment it is live. Whoever asked
          their system to stop animating reads the same two levels standing
          still. */}
      {isMicStarted && (
        <div className="mt-3">
          {reduced ? (
            <Levels isHeard={isHeard} isStarted={isStarted} />
          ) : (
            <AudioTimeline
              measures={measures}
              pendingSince={pendingSince}
              isUserLive={isHeard}
              isAssistantLive={state.isAssistantSpeaking}
            />
          )}
        </div>
      )}

      {error && (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-xs leading-relaxed text-danger">
          <PiWarningBold
            aria-hidden="true"
            className="mt-0.5 h-3.5 w-3.5 shrink-0"
          />
          <span>
            <strong className="font-semibold">{error.code}</strong>
            {error.message ? ` ${error.message}` : ''}
          </span>
        </p>
      )}
    </div>
  )
}

/**
 * The two levels, standing still.
 *
 * What the timeline draws, for whoever asked their system to stop animating.
 * The readings are taken here rather than in the dock, so a level arriving ten
 * times a second leaves the call around it alone.
 */
function Levels({
  isHeard,
  isStarted,
}: {
  isHeard: boolean
  isStarted: boolean
}) {
  const { micVolume } = useMicVolume()
  const { speakerVolume } = useSpeakerVolume()

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <Meter label="You" value={isHeard ? decibelLevel(micVolume) : 0} />
      {isStarted && (
        <Meter
          label="Assistant"
          tone="voice"
          value={decibelLevel(speakerVolume)}
        />
      )}
    </div>
  )
}

/**
 * How long the last answers kept the caller waiting.
 *
 * The timeline already brackets each wait where it happened. This is the same
 * reading settled into words, and it survives the audio scrolling away.
 */
function ReplyLatencyLine({ measures }: { measures: ReplyLatency[] }) {
  const last = measures[measures.length - 1]
  if (!last) return null

  const average =
    measures.reduce((total, measure) => total + measure.ms, 0) / measures.length

  return (
    <span className="text-xs text-faint">
      Answered in{' '}
      <span className="font-mono text-dim">{formatWait(last.ms)}</span>
      {measures.length > 1 && (
        <>
          , <span className="font-mono text-dim">{formatWait(average)}</span> on
          average over {measures.length} turns
        </>
      )}
    </span>
  )
}

/** What the call is doing, in the words someone watching it would use */
function statusLine(state: MicdropState): string {
  if (state.error) return 'The call stopped on an error'
  if (state.isStarting) return 'Connecting to the server'
  if (state.isReconnecting) return 'Connection lost, trying again'
  if (state.isPaused) return 'Paused, the assistant hears nothing'
  if (state.isProcessing) return 'The assistant is thinking'
  if (state.isAssistantSpeaking) return 'The assistant is speaking'
  if (state.isUserSpeaking) return 'You are speaking'
  // A muted microphone hears nothing, whether or not there is a call for it
  // to hear, so it is read before the state of the line
  if (state.isMuted) return 'Muted, nothing is being heard'
  if (!state.isStarted) {
    return state.isMicStarted
      ? 'The microphone is on, nobody is on the line'
      : 'Ready to call'
  }
  return 'Listening'
}

/** A reading in decibels below zero, placed between silence and the loudest */
function decibelLevel(volume: number): number {
  if (!Number.isFinite(volume)) return 0
  return Math.min(1, Math.max(0, (volume + 100) / 100))
}

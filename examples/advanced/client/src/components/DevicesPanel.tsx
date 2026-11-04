import { useMicdropState } from '@micdrop/react'
import { Micdrop } from '@micdrop/web'
import { useState } from 'react'
import {
  PiMicrophoneBold,
  PiMicrophoneSlashBold,
  PiSpeakerHighBold,
} from 'react-icons/pi'
import { getVADConfig } from '../detection'
import {
  setInterruptionsEnabled,
  useInterruptionsEnabled,
} from '../interruptions'
import Button from './ui/Button'
import Field from './ui/Field'
import Panel from './ui/Panel'
import Select from './ui/Select'
import Switch from './ui/Switch'
import SpeakerTestButton from './SpeakerTestButton'

const ECHO_LABELS = {
  normal: 'Playing through the audio context',
  fallback: 'Echo heard, playing through an audio element',
  disabled: 'Echo heard again, interruptions are off for this call',
}

/**
 * Which microphone is being heard and which speaker is answering.
 *
 * The panel stays on the page before the first call, saying so, rather than
 * appearing halfway down the rail and pushing everything below it. The
 * microphone can be started on its own from here, which is how the devices
 * get named and the levels get watched before anyone is on the line.
 */
export default function DevicesPanel() {
  const {
    isMicStarted,
    micDeviceId,
    micDevices,
    speakerDeviceId,
    speakerDevices,
    isMuted,
    isStarted,
  } = useMicdropState()
  const echoLabel = isStarted ? ECHO_LABELS[Micdrop.echoStage] : undefined
  const interruptions = useInterruptionsEnabled()
  const [isStartingMic, setIsStartingMic] = useState(false)

  // The microphone starts with the detectors picked below, the same ones the
  // call would give it. A refusal is reported through the call state, so it is
  // caught here rather than left to reject on its own.
  const handleStartMic = async () => {
    setIsStartingMic(true)
    try {
      await Micdrop.startMic({ vad: getVADConfig() })
    } catch {
      // The error is already on the call state, which the dock shows
    } finally {
      setIsStartingMic(false)
    }
  }

  return (
    <Panel
      title="Devices"
      icon={<PiSpeakerHighBold className="h-4 w-4" />}
      description="The microphone and the speaker this call runs on."
    >
      {isMicStarted ? (
        <>
          <Field label="Microphone">
            <Select
              className="min-w-0 flex-1"
              value={micDeviceId}
              aria-label="Microphone"
              onChange={(event) => Micdrop.changeMicDevice(event.target.value)}
            >
              {micDevices.map(({ id, label }) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </Select>
            {/* On the right of the select, where the speaker line keeps its
                own button, so both rows end on the control that acts */}
            <button
              type="button"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg
                border border-line bg-raised transition-colors duration-150 ease-rise
                hover:border-line-strong"
              aria-label={
                isMuted ? 'Unmute the microphone' : 'Mute the microphone'
              }
              onClick={isMuted ? Micdrop.unmute : Micdrop.mute}
            >
              {isMuted ? (
                <PiMicrophoneSlashBold
                  aria-hidden="true"
                  className="h-4 w-4 text-danger"
                />
              ) : (
                <PiMicrophoneBold
                  aria-hidden="true"
                  className="h-4 w-4 text-accent-ink"
                />
              )}
            </button>
          </Field>

          <Field label="Speaker">
            <Select
              className="min-w-0 flex-1"
              value={speakerDeviceId}
              aria-label="Speaker"
              onChange={(event) =>
                Micdrop.changeSpeakerDevice(event.target.value)
              }
            >
              {speakerDevices.map(({ id, label }) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </Select>
            <SpeakerTestButton />
          </Field>
        </>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-xs leading-relaxed text-faint">
            The browser names the devices only once it has been given the
            microphone. Start it here to pick them and watch the level before
            there is anyone on the line.
          </p>
          <div className="flex justify-start">
            <Button
              variant="primary"
              size="sm"
              disabled={isStartingMic}
              icon={<PiMicrophoneBold aria-hidden="true" className="h-3 w-3" />}
              onClick={handleStartMic}
            >
              {isStartingMic ? 'Starting' : 'Start mic'}
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 border-t border-line pt-4">
        <Switch
          label="Interruptions"
          help="Speak over the assistant to cut it off. If it keeps cutting itself off, the microphone is hearing its voice: turn this off and the microphone waits for the assistant to finish."
          checked={interruptions}
          disabled={isStarted}
          reason={isStarted ? 'Applied on the next call' : undefined}
          onChange={setInterruptionsEnabled}
        />
        {echoLabel && (
          <p className="text-xs leading-relaxed text-faint">{echoLabel}</p>
        )}
      </div>
    </Panel>
  )
}

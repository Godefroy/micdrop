import { SileroVAD, SileroVADOptions } from '@micdrop/web'
import { useState } from 'react'
import ResetButton from './ResetButton'
import Slider from './ui/Slider'

/** What the Silero model counts as speech, one 32 ms window at a time */
export default function SileroVADSettings({ vad }: { vad: SileroVAD }) {
  const [options, setOptions] = useState(vad.options)

  const setOption = (key: keyof SileroVADOptions, value: number) => {
    setOptions({ ...options, [key]: value })
    vad.setOptions({ [key]: value })
  }

  const resetOptions = () => {
    vad.resetOptions()
    setOptions(vad.options)
  }

  return (
    <>
      <Slider
        label="Positive speech threshold"
        help="Above this probability, a window counts as speech"
        value={options.positiveSpeechThreshold}
        min={0}
        max={1}
        step={0.01}
        onChange={(value) => setOption('positiveSpeechThreshold', value)}
      />
      <Slider
        label="Negative speech threshold"
        help="Below this probability, a window counts as silence"
        value={options.negativeSpeechThreshold}
        min={0}
        max={1}
        step={0.01}
        onChange={(value) => setOption('negativeSpeechThreshold', value)}
      />
      <Slider
        label="Min speech frames"
        help="After this many speech windows, the detector decides you are speaking"
        value={options.minSpeechFrames}
        min={1}
        max={40}
        step={1}
        onChange={(value) => setOption('minSpeechFrames', value)}
      />
      <Slider
        label="Redemption frames"
        help="After this many silent windows, the detector decides you stopped speaking"
        value={options.redemptionFrames}
        min={1}
        max={40}
        step={1}
        onChange={(value) => setOption('redemptionFrames', value)}
      />
      <ResetButton onClick={resetOptions} />
    </>
  )
}

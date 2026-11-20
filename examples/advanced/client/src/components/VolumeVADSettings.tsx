import { VolumeVAD, VolumeVADOptions } from '@micdrop/web'
import { useState } from 'react'
import ResetButton from './ResetButton'
import Slider from './ui/Slider'

/** What VolumeVAD counts as speech, and how long it waits before giving up */
export default function VolumeVADSettings({ vad }: { vad: VolumeVAD }) {
  const [options, setOptions] = useState(vad.options)

  const setOption = (key: keyof VolumeVADOptions, value: number) => {
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
        label="History"
        help="The detector reads the level every 100 ms and decides you stopped speaking after this many quiet readings in a row"
        value={options.history}
        min={1}
        max={20}
        step={1}
        onChange={(value) => setOption('history', value)}
      />
      <Slider
        label="Threshold"
        help="Above this level, the audio counts as speech"
        value={options.threshold}
        min={-100}
        max={0}
        step={1}
        format={(value) => `${value} dB`}
        onChange={(value) => setOption('threshold', value)}
      />
      <ResetButton onClick={resetOptions} />
    </>
  )
}

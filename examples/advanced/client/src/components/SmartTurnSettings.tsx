import { useState } from 'react'
import { smartTurn, useDetection } from '../detection'
import ResetButton from './ResetButton'
import Slider from './ui/Slider'

/**
 * What the turn detection model answers, and what happens when it is wrong.
 *
 * The last verdict is shown here rather than in the header because it is worth
 * reading with the thresholds that produced it.
 */
export default function SmartTurnSettings() {
  const { maxWait, lastResult, setMaxWait, resetSmartTurnOptions } =
    useDetection()
  const [threshold, setThreshold] = useState(smartTurn.options.threshold)

  const setOption = (value: number) => {
    setThreshold(value)
    smartTurn.setOptions({ threshold: value })
  }

  const resetOptions = () => {
    resetSmartTurnOptions()
    setThreshold(smartTurn.options.threshold)
  }

  return (
    <>
      <Slider
        label="Threshold"
        help="Above this, the sentence counts as finished"
        value={threshold}
        min={0.05}
        max={0.95}
        step={0.01}
        onChange={setOption}
      />
      <Slider
        label="Max wait"
        help="The assistant answers after this wait, even when the sentence sounds unfinished"
        value={maxWait}
        min={500}
        max={8000}
        step={100}
        format={(value) => `${(value / 1000).toFixed(1)} s`}
        onChange={setMaxWait}
      />
      <ResetButton onClick={resetOptions} />

      {lastResult && (
        <div className="flex flex-col gap-2 rounded-lg bg-inset px-3 py-2.5">
          <p className="text-xs text-faint">Last verdict</p>
          <p className="text-sm leading-relaxed text-main">
            The sentence sounded{' '}
            <strong
              className={`font-semibold ${
                lastResult.complete ? 'text-accent-ink' : 'text-warn'
              }`}
            >
              {lastResult.complete ? 'finished' : 'unfinished'}
            </strong>{' '}
            at{' '}
            <span className="font-mono tabular-nums">
              {Math.round(lastResult.probability * 100)}%
            </span>{' '}
            confidence. Smart Turn took{' '}
            <span className="font-mono tabular-nums">
              {lastResult.duration} ms
            </span>
            .
          </p>
          {!lastResult.complete && (
            <p className="text-xs leading-relaxed text-faint">
              The assistant answers anyway if you say nothing more within{' '}
              {(maxWait / 1000).toFixed(1)} s.
            </p>
          )}
        </div>
      )}
    </>
  )
}

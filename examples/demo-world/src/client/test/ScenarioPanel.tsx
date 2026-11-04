import { useEffect, useRef, useState } from 'react'
import { SCENARIO, ScenarioStep, playScenario } from '../drivers/scenario'
import { Row, Section, TestButton } from './Panel'

/** Plays the four acts end to end, without a microphone or an API key. */
export default function ScenarioPanel() {
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(-1)
  const stop = useRef<(() => void) | undefined>(undefined)

  useEffect(() => () => stop.current?.(), [])

  // ?play starts the arc on load, which is how it gets recorded or captured.
  useEffect(() => {
    if (!new URLSearchParams(location.search).has('play')) return
    handlePlay()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handlePlay = () => {
    stop.current?.()
    setCurrent(-1)
    setPlaying(true)
    stop.current = playScenario((_step: ScenarioStep, index: number) => {
      setCurrent(index)
      if (index === SCENARIO.length - 1) setPlaying(false)
    })
  }

  const handleStop = () => {
    stop.current?.()
    setPlaying(false)
  }

  return (
    <Section title="scénario complet">
      <Row>
        <TestButton label={playing ? 'en cours' : 'jouer'} onClick={handlePlay} active={playing} />
        <TestButton label="arrêter" onClick={handleStop} />
      </Row>
      <ol className="mt-1 flex flex-col gap-0.5">
        {SCENARIO.map((step, index) => (
          <li
            key={step.at}
            className={[
              'text-[11px] transition-colors',
              index === current ? 'text-[#dbe6ff]' : 'text-[#5f5c72]',
            ].join(' ')}
          >
            <span className="mr-2 tabular-nums">{step.at}s</span>
            {step.label}
          </li>
        ))}
      </ol>
    </Section>
  )
}

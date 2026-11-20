import { ReactNode } from 'react'
import Panel from './ui/Panel'
import Switch from './ui/Switch'

interface DetectorCardProps {
  name: string
  description: string
  enabled: boolean
  onToggle: (enabled: boolean) => void
  /** Switching this one off would leave the microphone deaf */
  lockedOn?: boolean
  /** Something else is doing this job, so it cannot be switched on */
  lockedOff?: boolean
  note?: string
  status?: ReactNode
  children: ReactNode
}

/**
 * One detector, switchable from its header and tunable once unfolded.
 *
 * The header carries what is worth seeing without opening anything: whether
 * the detector is on, what it is doing right now, and what it just answered.
 * The switch sits outside the fold button, so neither control swallows the
 * other's clicks.
 */
export default function DetectorCard({
  name,
  description,
  enabled,
  onToggle,
  lockedOn,
  lockedOff,
  note,
  status,
  children,
}: DetectorCardProps) {
  return (
    <Panel
      collapsible
      title={name}
      description={description}
      note={note}
      muted={!enabled}
      aside={status}
      lead={
        <Switch
          hideLabel
          label={`Turn ${name} ${enabled ? 'off' : 'on'}`}
          checked={enabled}
          disabled={lockedOn || lockedOff}
          reason={
            lockedOn
              ? 'Keep at least one voice detector on'
              : lockedOff
                ? `${name} runs on the server`
                : undefined
          }
          onChange={onToggle}
        />
      }
    >
      {children}
    </Panel>
  )
}

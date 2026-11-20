import { useMicdropState } from '@micdrop/react'
import { AUTO_OPTIONS, TOOL_OPTIONS, useProviders } from '../providers'
import Group from './ui/Group'
import Switch from './ui/Switch'

/**
 * The behaviors the agent runs on every turn and the tools it is given, set
 * for the next call. Both fold away, since they are tuned far less often than
 * the providers and the prompt above them.
 *
 * They live here rather than in the server code because their reliability is
 * what changes most between a hosted model and a small local one, and turning
 * them off one at a time is how you find which one a model mishandles. What
 * each one costs is written under it, since that is the reason to touch them.
 */
export default function AgentOptions() {
  const { isStarted } = useMicdropState()
  const { auto, toggleAuto, tools, toggleTool } = useProviders()

  return (
    <>
      <Group
        title="Agent behaviors"
        description="Each one costs the model a tool call on every turn."
        collapsible
        className="border-t border-line pt-4"
      >
        <div className="flex flex-col gap-3">
          {AUTO_OPTIONS.map((option) => (
            <Switch
              key={option.name}
              label={option.label}
              help={option.help}
              checked={auto[option.name]}
              disabled={isStarted}
              onChange={(enabled) => toggleAuto(option.name, enabled)}
            />
          ))}
        </div>
      </Group>

      <Group
        title="Agent tools"
        collapsible
        className="border-t border-line pt-4"
      >
        <div className="flex flex-col gap-3">
          {TOOL_OPTIONS.map((option) => (
            <Switch
              key={option.name}
              label={option.label}
              help={option.help}
              checked={tools[option.name]}
              disabled={isStarted}
              onChange={(enabled) => toggleTool(option.name, enabled)}
            />
          ))}
        </div>
      </Group>
    </>
  )
}

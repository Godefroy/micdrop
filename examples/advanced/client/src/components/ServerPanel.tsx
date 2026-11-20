import { useMicdropState } from '@micdrop/react'
import { PiCpuBold } from 'react-icons/pi'
import { useDetection } from '../detection'
import { useProviders } from '../providers'
import AgentOptions from './AgentOptions'
import PromptSettings from './PromptSettings'
import ProvidersFields from './ProvidersFields'
import ResetButton from './ResetButton'
import Group from './ui/Group'
import Panel from './ui/Panel'
import Switch from './ui/Switch'

/**
 * Everything the client sends when a call starts.
 *
 * These settings travel to the server rather than acting in the browser, so
 * they can only change between calls, and they sit in one panel that says so.
 * Inside it they are read as separate subjects, which is what the single
 * scrolling list they used to be never made clear.
 */
export default function ServerPanel() {
  const { isStarted } = useMicdropState()
  const { serverTurnDetection, toggleServerTurnDetection } = useDetection()
  const { resetAll } = useProviders()

  // Smart Turn is stored with the other detectors, so the panel puts it back
  // itself rather than through the providers store
  const handleReset = () => {
    resetAll()
    toggleServerTurnDetection(false)
  }

  return (
    <Panel title="Call setup" icon={<PiCpuBold className="h-4 w-4" />}>
      {/* The language and the providers open the panel under its own title,
          the language being no provider */}
      <ProvidersFields />

      <PromptSettings />
      <AgentOptions />

      <Group title="Turn detection" className="border-t border-line pt-4">
        <Switch
          label="Run Smart Turn on the server"
          help="The same model as the Smart Turn detector, loaded by the server instead of the browser. Nothing to download on the device, at the cost of a round trip before each answer. The browser then leaves turns alone."
          checked={serverTurnDetection}
          disabled={isStarted}
          onChange={toggleServerTurnDetection}
        />
      </Group>

      <div className="flex flex-col gap-2 border-t border-line pt-4">
        {isStarted && (
          <p className="text-xs text-faint">
            Stop the call to change any of this.
          </p>
        )}
        <ResetButton onClick={handleReset} disabled={isStarted} />
      </div>
    </Panel>
  )
}

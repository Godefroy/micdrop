import { useMicdropState } from '@micdrop/react'
import { useProviders } from '../providers'
import Group from './ui/Group'

/**
 * The system prompt given to the agent, written for the next call.
 *
 * The demo starts from the prompt of the server and keeps whatever is written
 * here in the browser storage, so trying a persona, a script or a whole other
 * task is a matter of typing rather than of editing the server and restarting
 * it. The language of the conversation stays with the server, which resolves
 * it from the voice and the transcription model.
 */
export default function PromptSettings() {
  const { isStarted } = useMicdropState()
  const { prompt, writePrompt } = useProviders()

  if (prompt === undefined) return null

  return (
    <Group
      title="System prompt"
      className="border-t border-line pt-4"
    >
      <textarea
        className="w-full resize-y rounded-lg border border-line bg-inset px-3 py-2
          font-mono text-xs leading-relaxed text-main transition-colors duration-150
          ease-rise hover:border-line-strong disabled:cursor-not-allowed disabled:text-faint"
        rows={7}
        spellCheck={false}
        value={prompt}
        disabled={isStarted}
        aria-label="System prompt"
        onChange={(event) => writePrompt(event.target.value)}
      />
    </Group>
  )
}

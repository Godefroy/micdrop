import { useMicdropState } from '@micdrop/react'
import {
  MicdropConversationItem,
  MicdropConversationToolResult,
} from '@micdrop/web'
import { useEffect, useRef } from 'react'
import { PiCheckBold, PiWaveformBold, PiWrenchBold } from 'react-icons/pi'

interface Props {
  className?: string
}

/**
 * What was said, and what the agent did about it.
 *
 * Reading the call state is kept apart from drawing it, so the transcript can
 * be rendered against a conversation of its own.
 */
export default function Transcript({ className }: Props) {
  const { conversation, isStarted, isProcessing, partialAssistantMessage } =
    useMicdropState()
  return (
    <TranscriptView
      conversation={conversation}
      isStarted={isStarted}
      isProcessing={isProcessing}
      partialAssistantMessage={partialAssistantMessage}
      className={className}
    />
  )
}

interface TranscriptViewProps extends Props {
  conversation: MicdropConversationItem[]
  isStarted: boolean
  isProcessing: boolean
  /**
   * The answer as the agent writes it, sent by a server running with
   * `partialMessages`. Empty until the first words arrive, and empty again once
   * the finished message has taken its place in the conversation.
   */
  partialAssistantMessage?: string
}

/**
 * The transcript itself.
 *
 * The view follows the newest line only while it is already at the bottom, so
 * scrolling back through a long call to compare two answers is not undone by
 * the next one arriving.
 */
export function TranscriptView({
  conversation,
  isStarted,
  isProcessing,
  partialAssistantMessage = '',
  className = '',
}: TranscriptViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const isPinnedRef = useRef(true)

  const handleScroll = () => {
    const element = scrollRef.current
    if (!element) return
    const distance =
      element.scrollHeight - element.scrollTop - element.clientHeight
    isPinnedRef.current = distance < 80
  }

  useEffect(() => {
    if (!isPinnedRef.current) return
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [conversation.length, isProcessing, partialAssistantMessage])

  // The answer being written takes the place the finished one will occupy, so
  // the two share a key and React keeps the same bubble. Nothing moves when the
  // message settles, only the caret goes.
  const lines: MicdropConversationItem[] = partialAssistantMessage
    ? [...conversation, { role: 'assistant', content: partialAssistantMessage }]
    : conversation

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className={`overflow-y-auto rounded-xl border border-line bg-panel p-4 ${className}`}
    >
      {lines.length === 0 ? (
        <EmptyTranscript isStarted={isStarted} />
      ) : (
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {lines.map((item, index) => (
            <Line
              key={index}
              item={item}
              conversation={conversation}
              pending={index === conversation.length}
            />
          ))}
          {isProcessing && !partialAssistantMessage && <Thinking />}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  )
}

/** Nothing has been said yet, which is most of the time before a first call */
function EmptyTranscript({ isStarted }: { isStarted: boolean }) {
  return (
    <div className="flex h-full min-h-40 flex-col items-center justify-center gap-3 text-center">
      <span
        aria-hidden="true"
        className="flex h-11 w-11 items-center justify-center rounded-xl bg-inset text-faint"
      >
        <PiWaveformBold className="h-5 w-5" />
      </span>
      <p className="max-w-xs text-sm leading-relaxed text-faint">
        {isStarted
          ? 'The call is up. Say something and the transcript starts here.'
          : 'Start the call and everything said lands here, with the tools the agent reaches for along the way.'}
      </p>
    </div>
  )
}

/** The answer is being written, in the shape the answer will take */
function Thinking() {
  return (
    <div className="mr-auto flex w-48 max-w-[85%] flex-col gap-2 rounded-xl rounded-bl-lg border border-line bg-raised px-3.5 py-3">
      <span className="sr-only">The assistant is answering</span>
      <span
        aria-hidden="true"
        className="h-2 w-full animate-pulse rounded-full bg-inset"
      />
      <span
        aria-hidden="true"
        className="h-2 w-2/3 animate-pulse rounded-full bg-inset"
      />
    </div>
  )
}

interface LineProps {
  item: MicdropConversationItem
  conversation: MicdropConversationItem[]
  /** This answer is still being written */
  pending?: boolean
}

function Line({ item, conversation, pending }: LineProps) {
  switch (item.role) {
    case 'user':
      return (
        <p className="ml-auto max-w-[85%] animate-rise whitespace-pre-wrap rounded-xl rounded-br-lg bg-accent-soft px-3.5 py-2.5 text-sm leading-relaxed text-main">
          {item.content}
        </p>
      )

    case 'assistant':
      return (
        <p
          aria-busy={pending}
          className="mr-auto max-w-[85%] animate-rise whitespace-pre-wrap rounded-xl rounded-bl-lg border border-line bg-raised px-3.5 py-2.5 text-sm leading-relaxed text-main"
        >
          {item.content}
          {pending && <Caret />}
        </p>
      )

    case 'system':
      return (
        <p className="mx-auto max-w-[85%] animate-rise text-center text-xs leading-relaxed text-faint">
          {item.content}
        </p>
      )

    case 'tool_call': {
      const result = conversation.find(
        (message): message is MicdropConversationToolResult =>
          message.role === 'tool_result' &&
          message.toolCallId === item.toolCallId
      )
      return (
        <div className="mr-auto max-w-[85%] animate-rise rounded-xl border border-line bg-inset px-3.5 py-3">
          <p className="flex items-center gap-2 font-mono text-xs text-voice-ink">
            <PiWrenchBold aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            {item.toolName}
          </p>
          <Json label="Called with" value={item.parameters} />
          {result && (
            <Json
              label="Answered"
              value={result.output}
              icon={
                <PiCheckBold
                  aria-hidden="true"
                  className="h-3 w-3 text-accent"
                />
              }
            />
          )}
        </div>
      )
    }

    default:
      return null
  }
}

/** Marks an answer that is still arriving, word after word */
function Caret() {
  return (
    <span
      aria-hidden="true"
      className="ml-1 inline-block h-3.5 w-1.5 translate-y-px animate-breathe rounded-xs bg-accent align-middle"
    />
  )
}

interface JsonProps {
  label: string
  /** JSON as the agent exchanged it, which is a string on both sides */
  value: string
  icon?: React.ReactNode
}

/** One side of a tool call, laid out rather than run together on one line */
function Json({ label, value, icon }: JsonProps) {
  return (
    <div className="mt-2 flex flex-col gap-1">
      <span className="flex items-center gap-1.5 text-xs text-faint">
        {icon}
        {label}
      </span>
      <pre className="overflow-x-auto rounded-lg bg-panel px-2.5 py-2 font-mono text-xs leading-relaxed text-dim">
        {format(value)}
      </pre>
    </div>
  )
}

/** Pretty prints what came as JSON, and shows the rest as it arrived */
function format(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

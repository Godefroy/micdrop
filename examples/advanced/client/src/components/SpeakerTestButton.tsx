import { Speaker } from '@micdrop/web'
import { useMicdropState } from '@micdrop/react'
import { useRef, useState } from 'react'
import { PiPlayFill, PiStopFill } from 'react-icons/pi'
import Button from './ui/Button'

/** Plays a recorded answer through the chosen speaker, to hear it before a call */
export default function SpeakerTestButton() {
  const { isAssistantSpeaking } = useMicdropState()
  const [loading, setLoading] = useState(false)
  const timeoutRef = useRef<number | undefined>(undefined)

  const handleClick = async () => {
    clearTimeout(timeoutRef.current)

    if (Speaker.isPlaying) {
      Speaker.stopAudio()
      return
    }

    setLoading(true)

    const filepathPattern = '/chunk-{i}.wav'
    let i = 1

    const playNextChunk = async () => {
      // Fetch audio chunk
      const filepath = filepathPattern.replace('{i}', i.toString())
      const result = await fetch(filepath)
      if (!result.ok) return

      // Play audio, the files hold raw PCM16 at 16 kHz like the server sends
      const audio = await result.arrayBuffer()
      Speaker.playAudio(audio)
      i++
      setLoading(false)

      // Schedule next chunk
      timeoutRef.current = window.setTimeout(playNextChunk, 100)
    }

    playNextChunk()
  }

  return (
    <Button
      size="sm"
      disabled={loading}
      icon={
        isAssistantSpeaking ? (
          <PiStopFill aria-hidden="true" className="h-3 w-3" />
        ) : (
          <PiPlayFill aria-hidden="true" className="h-3 w-3" />
        )
      }
      onClick={handleClick}
    >
      Test
    </Button>
  )
}

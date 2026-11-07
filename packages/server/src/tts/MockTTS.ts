import * as fs from 'fs'
import { Readable } from 'stream'
import { TTS } from './TTS'

/**
 * Plays the same recorded chunks for any answer, to run a call without a
 * voice provider. The files hold raw PCM 16 bits at 16 kHz.
 */
export class MockTTS extends TTS {
  // Bumped by every answer and every cancel, so the chunks of an answer that
  // is no longer wanted stop there
  private generation = 0

  constructor(private audioFilePaths: string[]) {
    super()
  }

  speak(textStream: Readable) {
    const generation = ++this.generation
    textStream.once('data', async () => {
      for (const filePath of this.audioFilePaths) {
        await new Promise((resolve) => setTimeout(resolve, 200))
        if (generation !== this.generation) return
        const audio = fs.readFileSync(filePath)
        this.log(`Loaded chunk (${audio.length} bytes)`)
        this.emit('Audio', audio)
      }
    })
  }

  cancel() {
    this.generation++
  }
}

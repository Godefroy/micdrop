import { TTS } from '@micdrop/server'
import { Readable } from 'stream'
import { DialogueWebSocket } from './DialogueWebSocket'
import { ElevenLabsWebSocket } from './ElevenLabsWebSocket'
import { SpeechWebSocket } from './SpeechWebSocket'
import {
  DEFAULT_MODEL_ID,
  ElevenLabsTTSOptions,
  isDialogueModel,
} from './types'

/**
 * ElevenLabs text to speech, streamed over the WebSocket the model runs on.
 *
 * Eleven v3 and v4 only answer on the Text to Dialogue WebSocket, the other
 * models on the Text to Speech WebSocket. The two speak different protocols,
 * so the model picks the one this class drives.
 */
export class ElevenLabsTTS extends TTS {
  private readonly webSocket: ElevenLabsWebSocket

  constructor(options: ElevenLabsTTSOptions) {
    super()
    const host = {
      audio: (chunk: Buffer) => this.emit('Audio', chunk),
      failed: (texts: string[]) => this.emit('Failed', texts),
      log: (...message: any[]) => this.log(...message),
    }
    this.webSocket = isDialogueModel(options.modelId ?? DEFAULT_MODEL_ID)
      ? new DialogueWebSocket(options, host)
      : new SpeechWebSocket(options, host)
  }

  speak(textStream: Readable) {
    this.webSocket.speak(textStream)
  }

  cancel() {
    this.webSocket.cancel()
  }

  destroy() {
    this.webSocket.destroy()
    super.destroy()
  }
}

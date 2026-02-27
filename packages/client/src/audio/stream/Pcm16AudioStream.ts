import { audioContext } from '../utils/audioContext'
import { AudioStream } from './AudioStream'

const SAMPLE_RATE = 16000
const CHANNELS = 1

export class Pcm16AudioStream extends AudioStream {
  private audioQueue: AudioBuffer[] = []
  private sourceNodes: AudioBufferSourceNode[] = []
  private nextStartTime = 0

  constructor() {
    super()
  }

  start(): AudioNode {
    return this.outputNode
  }

  async playAudio(blob: Blob): Promise<void> {
    try {
      // Convert blob to PCM data
      const arrayBuffer = await blob.arrayBuffer()

      // Convert PCM data to AudioBuffer with proper sample rate
      const audioBuffer = this.createAudioBuffer(arrayBuffer)

      if (audioBuffer) {
        this.audioQueue.push(audioBuffer)
        this.processQueue()
      }
    } catch (error) {
      console.error('Failed to play audio chunk:', error)
    }
  }

  stopAudio(): void {
    for (const node of this.sourceNodes) {
      try {
        node.stop()
        node.disconnect()
      } catch (error) {
        // Ignore errors when stopping
      }
    }
    this.sourceNodes = []
    this.audioQueue = []
    this.nextStartTime = 0
    this.setIsPlaying(false)
  }

  private createAudioBuffer(arrayBuffer: ArrayBuffer): AudioBuffer | null {
    try {
      // Convert ArrayBuffer to Int16Array (assuming 16-bit PCM)
      const int16Data = new Int16Array(arrayBuffer)

      // Calculate number of samples
      const numSamples = int16Data.length

      if (numSamples === 0) {
        return null
      }

      // Create AudioBuffer with the correct sample rate
      const audioBuffer = audioContext.createBuffer(
        CHANNELS,
        numSamples,
        SAMPLE_RATE
      )

      // Convert 16-bit PCM to float32 and copy to AudioBuffer
      const channelData = audioBuffer.getChannelData(0)
      for (let i = 0; i < numSamples; i++) {
        channelData[i] = int16Data[i] / 32768.0
      }

      return audioBuffer
    } catch (error) {
      console.error('Error creating AudioBuffer:', error)
      return null
    }
  }

  private processQueue(): void {
    while (this.audioQueue.length > 0) {
      const audioBuffer = this.audioQueue.shift()!
      this.scheduleBuffer(audioBuffer)
    }
  }

  private scheduleBuffer(audioBuffer: AudioBuffer): void {
    const sourceNode = audioContext.createBufferSource()
    sourceNode.buffer = audioBuffer
    sourceNode.connect(this.outputNode)

    // Schedule this buffer right after the previous one ends
    const now = audioContext.currentTime
    const startTime = Math.max(this.nextStartTime, now)
    this.nextStartTime = startTime + audioBuffer.duration

    sourceNode.onended = () => {
      // Remove from tracked nodes
      const index = this.sourceNodes.indexOf(sourceNode)
      if (index !== -1) this.sourceNodes.splice(index, 1)

      // If no more nodes playing and queue empty, playback is done
      if (this.sourceNodes.length === 0 && this.audioQueue.length === 0) {
        this.nextStartTime = 0
        this.setIsPlaying(false)
      }
    }

    this.sourceNodes.push(sourceNode)
    sourceNode.start(startTime)
    this.setIsPlaying(true)
  }
}

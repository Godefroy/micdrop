import { AudioAnalyser } from './utils/AudioAnalyser'
import { audioContext } from './utils/audioContext'
import { LocalStorageKeys } from './utils/localStorage'
import { stopStream } from './utils/stopStream'

export class Mic {
  public analyser = new AudioAnalyser(audioContext)
  public deviceId: string | undefined

  private audioStream: MediaStream | undefined
  private sourceNode: MediaStreamAudioSourceNode | undefined

  private getMicConstraints(deviceId?: string): MediaStreamConstraints {
    return {
      audio: {
        deviceId: { ideal: deviceId },
        sampleRate: 16000, // not working, it will follow device settings, usually 44.1kHz
        sampleSize: 16,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    }
  }

  /**
   * Starts the microphone
   * @param deviceId - The deviceId to use
   * @returns The microphone stream
   */
  async start(deviceId?: string): Promise<MediaStream> {
    if (!audioContext || !this.analyser) {
      throw new Error('AudioContext not initialized')
    }

    // Get deviceId from localStorage
    if (!deviceId) {
      deviceId = localStorage.getItem(LocalStorageKeys.MicDevice) || undefined
    }

    if (this.audioStream) {
      // deviceId has not changed, reuse previous stream
      if (this.deviceId === deviceId) {
        return this.audioStream
      }

      // deviceId has changed, stop previous stream
      stopStream(this.audioStream)
    }

    // Get stream from microphone
    this.audioStream = await navigator.mediaDevices.getUserMedia(
      this.getMicConstraints(deviceId)
    )

    // Store deviceId
    const track = this.audioStream.getTracks()[0]
    let newDeviceId =
      track && track.getCapabilities && track.getCapabilities().deviceId
    if (newDeviceId) {
      if (newDeviceId === 'default' && deviceId) {
        newDeviceId = deviceId
      }
      localStorage.setItem(LocalStorageKeys.MicDevice, newDeviceId)
      this.deviceId = newDeviceId
    } else {
      localStorage.removeItem(LocalStorageKeys.MicDevice)
      this.deviceId = undefined
    }

    // Connect to AudioContext
    if (this.sourceNode) this.sourceNode.disconnect()
    this.sourceNode = audioContext.createMediaStreamSource(this.audioStream)
    this.sourceNode.connect(this.analyser.node)

    return this.audioStream
  }

  /**
   * Stops the microphone
   */
  stop() {
    if (this.sourceNode) {
      this.sourceNode.disconnect()
      this.sourceNode = undefined
    }
    if (this.audioStream) {
      stopStream(this.audioStream)
      this.audioStream = undefined
    }
  }
}

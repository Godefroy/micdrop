import { MicSource } from '../types'
import { getVAD, VADConfigName } from './getVAD'
import { VAD, VADStatus } from './VAD'

/**
 * Combine an array of VADs
 */
export class MultipleVAD extends VAD {
  public readonly name = 'MultipleVAD'
  public vads: VAD[]

  constructor(vads: Array<VAD | VADConfigName>) {
    super()
    this.vads = vads.map((vad) => getVAD(vad))
    // The first VAD to hear something opens the turn, but any of them may be
    // the one that notices, so the reserve has to cover the slowest
    this.delay = Math.max(...this.vads.map((vad) => vad.delay))
  }

  get isStarted(): boolean {
    return this.vads.some((vad) => vad.isStarted)
  }

  get isPaused(): boolean {
    return this.vads.every((vad) => vad.isPaused)
  }

  async start(mic: MicSource): Promise<void> {
    // A call starts in silence, whatever the previous one ended on
    this.setStatus(VADStatus.Silence)
    for (const vad of this.vads) {
      // A VAD already running elsewhere is listened to all the same
      vad.off('ChangeStatus', this.onStatusChange)
      vad.on('ChangeStatus', this.onStatusChange)
      if (!vad.isStarted) {
        await vad.start(mic)
      }
    }
  }

  // Every VAD has to hear the speech, but only one has to be sure of it. A
  // short word like "No" is over before the volume VAD gathers the loud
  // reports it needs to confirm, while Silero confirms it right away.
  private onStatusChange = () => {
    const isAllSilence = this.vads.every(
      (vad) => vad.status === VADStatus.Silence
    )
    const isConfirmed =
      this.vads.every((vad) => vad.status !== VADStatus.Silence) &&
      this.vads.some((vad) => vad.status === VADStatus.Speaking)

    // Ensure events are called in order
    switch (this.status) {
      case VADStatus.Silence:
        if (isAllSilence) break
        this.emit('StartSpeaking')
        if (isConfirmed) {
          this.emit('ConfirmSpeaking')
        }
        break
      case VADStatus.MaybeSpeaking:
        if (isAllSilence) {
          this.emit('CancelSpeaking')
          break
        }
        if (isConfirmed) {
          this.emit('ConfirmSpeaking')
        }
        break
      case VADStatus.Speaking:
        if (isAllSilence) {
          this.emit('StopSpeaking')
        }
        break
    }
  }

  async stop(): Promise<void> {
    // Stopped before they are left, so the turn they close closes here too
    for (const vad of this.vads) {
      await vad.stop()
      vad.off('ChangeStatus', this.onStatusChange)
    }
  }

  async pause(): Promise<void> {
    for (const vad of this.vads) {
      await vad.pause()
    }
  }

  async resume(): Promise<void> {
    for (const vad of this.vads) {
      await vad.resume()
    }
  }
}

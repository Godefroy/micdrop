import { EventEmitter } from 'eventemitter3'
import { storage, MicdropStorageKeys } from '../storage'
import { MicdropDevice, SpeakerDriver } from './types'

export interface SpeakerEvents {
  StartPlaying: void
  StopPlaying: void
  /** Level of the audio being played */
  Volume: [number]
}

/**
 * The speaker, as a single object shared by the whole app.
 *
 * It wraps a {@link SpeakerDriver} and plays the 16 kHz PCM sent by the server
 * as it arrives.
 */
export class SpeakerController extends EventEmitter<SpeakerEvents> {
  private driver: SpeakerDriver | undefined

  /** Last level measured, in decibels, between -Infinity and 0 */
  public volume = -Infinity

  /**
   * Replaces the audio driver, to play sound with another library
   * @param driver - The driver to play with
   */
  setDriver(driver: SpeakerDriver) {
    if (this.driver === driver) return
    if (this.driver) {
      this.driver.off('StartPlaying', this.onStartPlaying)
      this.driver.off('StopPlaying', this.onStopPlaying)
      this.driver.off('Volume', this.onVolume)
    }
    this.driver = driver
    driver.on('StartPlaying', this.onStartPlaying)
    driver.on('StopPlaying', this.onStopPlaying)
    driver.on('Volume', this.onVolume)
  }

  getDriver(): SpeakerDriver {
    if (!this.driver) {
      throw new Error(
        'No speaker driver. Import @micdrop/web in a browser or @micdrop/react-native on a phone, or call Speaker.setDriver().'
      )
    }
    return this.driver
  }

  get isPlaying(): boolean {
    return this.driver?.isPlaying ?? false
  }

  get deviceId(): string | undefined {
    return this.driver?.deviceId
  }

  /** Prepares the audio graph, called before the first chunk arrives */
  async start() {
    const driver = this.getDriver()
    await driver.start()

    // Play through the output chosen last time, when it is still there
    const saved = storage.getItem(MicdropStorageKeys.SpeakerDevice)
    if (saved && saved !== driver.deviceId) {
      try {
        await driver.changeDevice(saved)
      } catch {
        storage.removeItem(MicdropStorageKeys.SpeakerDevice)
      }
    }
  }

  /**
   * Queues samples for playback, right after the ones already queued
   * @param pcm - Mono samples as 16 bits integers, or the bytes holding them
   * @param sampleRate - Sample rate of `pcm`, in Hz
   */
  playAudio(pcm: Int16Array | ArrayBuffer, sampleRate = 16000) {
    try {
      const samples = pcm instanceof Int16Array ? pcm : new Int16Array(pcm)
      this.getDriver().play(samples, sampleRate)
    } catch (error) {
      console.error('[Micdrop] Error playing audio', error)
    }
  }

  /** Drops everything queued and stops playing immediately */
  stopAudio() {
    this.driver?.stopAudio()
  }

  /** Releases the audio graph */
  async stop() {
    await this.driver?.stop()
    this.volume = -Infinity
  }

  /**
   * Plays through another output
   * @param deviceId - Output device, or route on a phone
   */
  async changeDevice(deviceId: string) {
    await this.getDriver().changeDevice(deviceId)
    storage.setItem(MicdropStorageKeys.SpeakerDevice, deviceId)
  }

  /** Lists the output devices the system offers */
  async getDevices(): Promise<MicdropDevice[]> {
    if (!this.driver) return []
    return this.driver.getDevices()
  }

  /**
   * Plays by another route, for when the microphone hears the current one
   * @returns False if the platform has no other route to offer
   */
  async useEchoFallback(): Promise<boolean> {
    return (await this.driver?.useEchoFallback()) ?? false
  }

  /** Goes back to the usual route */
  resetEchoFallback() {
    this.driver?.resetEchoFallback()
  }

  private onStartPlaying = () => this.emit('StartPlaying')
  private onStopPlaying = () => {
    this.volume = -Infinity
    this.emit('StopPlaying')
  }
  private onVolume = (volume: number) => {
    this.volume = volume
    this.emit('Volume', volume)
  }
}

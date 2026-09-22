import { EventEmitter } from 'eventemitter3'
import { concatFloat32, resample } from './pcm'
import { MicDriver, MicdropDevice, MicEvents } from './types'
import { VOLUME_SAMPLE_RATE, VolumeMeter } from './volume'

// Audio worth this much time is measured at once before reporting a level,
// which is also the pace at which the VAD makes decisions.
const VOLUME_INTERVAL = 100 // ms
// Samples the measurement looks at, at VOLUME_SAMPLE_RATE
const VOLUME_WINDOW = 512
// How long the captured audio is timed before its rate is judged
const RATE_CHECK_DURATION = 2000 // ms
// How far the delivered rate may drift from the announced one
const RATE_TOLERANCE = 0.15

/**
 * The microphone, as a single object shared by the whole app.
 *
 * It wraps a {@link MicDriver}, the browser one or the native one, and turns
 * the samples it captures into the level used by the VAD and by level meters.
 * Nothing here knows which platform it runs on.
 */
export class MicController extends EventEmitter<MicEvents> {
  private driver: MicDriver | undefined
  private meter = new VolumeMeter()
  private pending: Float32Array[] = []
  private pendingLength = 0
  private pendingRate = VOLUME_SAMPLE_RATE
  private rateCheckedAt = 0
  private rateCheckSamples = 0
  private rateWarned = false

  /** Last level measured, in decibels, between -Infinity and 0 */
  public volume = -Infinity

  /**
   * Replaces the audio driver, to record with another library
   * @param driver - The driver to record with
   */
  setDriver(driver: MicDriver) {
    if (this.driver === driver) return
    if (this.driver) {
      this.driver.off('Frames', this.onFrames)
      this.driver.off('DeviceChange', this.onDeviceChange)
      this.driver.off('Error', this.onError)
    }
    this.driver = driver
    driver.on('Frames', this.onFrames)
    driver.on('DeviceChange', this.onDeviceChange)
    driver.on('Error', this.onError)
  }

  getDriver(): MicDriver {
    if (!this.driver) {
      throw new Error(
        'No microphone driver. Import @micdrop/web in a browser or @micdrop/react-native on a phone, or call Mic.setDriver().'
      )
    }
    return this.driver
  }

  get isStarted(): boolean {
    return this.driver?.isStarted ?? false
  }

  get deviceId(): string | undefined {
    return this.driver?.deviceId
  }

  /** Whether echo cancellation is on, undefined when nobody knows */
  get echoCancellation(): boolean | undefined {
    return this.driver?.echoCancellation
  }

  /**
   * Asks for the microphone permission and starts capturing
   * @param deviceId - Input device to record from, defaults to the system one
   */
  async start(deviceId?: string) {
    this.resetVolume()
    await this.getDriver().start(deviceId)
  }

  /** Stops capturing and releases the microphone */
  async stop() {
    await this.driver?.stop()
    this.resetVolume()
  }

  /** Lists the input devices the system offers */
  async getDevices(): Promise<MicdropDevice[]> {
    if (!this.driver) return []
    return this.driver.getDevices()
  }

  private onFrames = (frames: Float32Array, sampleRate: number) => {
    this.emit('Frames', frames, sampleRate)
    this.checkRate(frames.length, sampleRate)

    if (sampleRate !== this.pendingRate) {
      this.pending = []
      this.pendingLength = 0
      this.pendingRate = sampleRate
      this.meter.reset()
    }

    this.pending.push(frames)
    this.pendingLength += frames.length

    const interval = Math.round((VOLUME_INTERVAL / 1000) * sampleRate)
    if (this.pendingLength < interval) return

    // Measure the end of what was gathered, which is what the room sounds like
    // right now
    const needed = Math.ceil((VOLUME_WINDOW * sampleRate) / VOLUME_SAMPLE_RATE)
    const gathered = concatFloat32(this.pending)
    const window = gathered.subarray(Math.max(0, gathered.length - needed))
    this.pending = []
    this.pendingLength = 0

    this.volume = this.meter.measure(
      resample(window, sampleRate, VOLUME_SAMPLE_RATE)
    )
    this.emit('Volume', this.volume)
  }

  /**
   * Times the captured audio against the rate it claims to be at.
   *
   * A microphone that announces 16 kHz while delivering 48 kHz sends speech to
   * the server three times too slow, which comes back as a short transcript in
   * a random language. That is invisible otherwise, so it is worth saying out
   * loud once.
   * @param samples - How many samples just arrived
   * @param sampleRate - The rate they are said to be at
   */
  private checkRate(samples: number, sampleRate: number) {
    if (this.rateWarned) return

    const now = Date.now()
    if (this.rateCheckedAt === 0) {
      this.rateCheckedAt = now
      return
    }

    this.rateCheckSamples += samples
    const elapsed = now - this.rateCheckedAt
    if (elapsed < RATE_CHECK_DURATION) return

    const delivered = (this.rateCheckSamples / elapsed) * 1000
    this.rateCheckedAt = now
    this.rateCheckSamples = 0

    if (Math.abs(delivered - sampleRate) / sampleRate <= RATE_TOLERANCE) return

    this.rateWarned = true
    console.warn(
      `[Micdrop] The microphone announces ${sampleRate} Hz but delivers about ${Math.round(delivered)} Hz. ` +
        'Speech is being sent at the wrong speed, so transcription will be poor.'
    )
  }

  private onDeviceChange = () => {
    this.emit('DeviceChange')
  }

  private onError = (error: Error) => {
    this.emit('Error', error)
  }

  private resetVolume() {
    this.pending = []
    this.pendingLength = 0
    this.meter.reset()
    this.volume = -Infinity
    this.rateCheckedAt = 0
    this.rateCheckSamples = 0
  }
}

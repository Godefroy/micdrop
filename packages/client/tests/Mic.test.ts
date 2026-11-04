import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { MicController } from '../src/audio/Mic'
import { FakeMicDriver, silence, sine } from './fakes'

describe('Mic', () => {
  let driver: FakeMicDriver
  let mic: MicController
  let volumes: number[]

  beforeEach(() => {
    driver = new FakeMicDriver()
    mic = new MicController()
    mic.setDriver(driver)
    volumes = []
    mic.on('Volume', (volume) => volumes.push(volume))
  })

  it('refuses to record without a driver', async () => {
    const bare = new MicController()
    await assert.rejects(() => bare.start())
  })

  it('passes the chosen device to the driver', async () => {
    await mic.start('usb-headset')
    assert.equal(driver.startedWith, 'usb-headset')
    assert.equal(mic.deviceId, 'usb-headset')
    assert.equal(mic.isStarted, true)
  })

  it('forwards the captured samples', () => {
    const frames: number[] = []
    mic.on('Frames', (samples) => frames.push(samples.length))
    driver.push(sine(0.01))
    assert.deepEqual(frames, [160])
  })

  it('reports a level about ten times a second', () => {
    // 10 ms frames, so one level every ten of them
    for (let i = 0; i < 30; i++) driver.push(sine(0.01, { amplitude: 0.5 }))
    assert.equal(volumes.length, 3)
  })

  it('measures speech well above the speech threshold', () => {
    for (let i = 0; i < 10; i++) driver.push(sine(0.01, { amplitude: 0.3 }))
    assert.ok(volumes[0] > -55, `speech measured at ${volumes[0]}`)
  })

  it('falls back under the threshold once the room goes quiet', () => {
    for (let i = 0; i < 10; i++) driver.push(sine(0.01, { amplitude: 0.3 }))
    for (let i = 0; i < 30; i++) driver.push(silence(0.01))

    // A little of the previous window is kept, as a browser AnalyserNode does,
    // so the level fades instead of dropping at once
    assert.ok(volumes[1] < volumes[0] - 15, 'it falls right away')
    assert.ok(
      volumes[2] < -55,
      `still above the speech threshold: ${volumes[2].toFixed(1)}`
    )
  })

  it('starts over when the device changes its sample rate', () => {
    for (let i = 0; i < 5; i++) driver.push(sine(0.01), 16000)
    for (let i = 0; i < 5; i++)
      driver.push(sine(0.01, { sampleRate: 48000 }), 48000)
    assert.deepEqual(volumes, [], 'the half filled window was dropped')

    // 48 kHz needs 480 samples per 10 ms, so ten frames make a window
    for (let i = 0; i < 27; i++) {
      driver.push(sine(0.01, { sampleRate: 48000 }), 48000)
    }
    assert.equal(volumes.length, 3)
  })

  it('warns when the microphone lies about its rate', async () => {
    const warnings: string[] = []
    const warn = console.warn
    console.warn = (message: string) => warnings.push(message)

    try {
      // Half a second of audio announced as 16 kHz, delivered over two seconds
      const start = Date.now()
      driver.push(sine(0.01), 16000)
      while (Date.now() - start < 2100) {
        driver.push(sine(0.001), 16000)
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    } finally {
      console.warn = warn
    }

    assert.equal(warnings.length, 1, 'said once, not on every frame')
    assert.match(warnings[0], /announces 16000 Hz but delivers/)
  })

  it('stays quiet when the rate is honest', async () => {
    const warnings: string[] = []
    const warn = console.warn
    console.warn = (message: string) => warnings.push(message)

    try {
      // Pushed against the clock, since a timer runs late on a busy machine and
      // would deliver less than real time
      const start = Date.now()
      let pushed = 0
      while (Date.now() - start < 2200) {
        const elapsed = (Date.now() - start) / 1000
        if (elapsed > pushed) {
          driver.push(sine(elapsed - pushed), 16000)
          pushed = elapsed
        }
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    } finally {
      console.warn = warn
    }

    assert.deepEqual(warnings, [])
  })

  it('lists what the driver offers', async () => {
    assert.deepEqual(await mic.getDevices(), driver.devices)
  })

  it('forgets the last level once stopped', async () => {
    for (let i = 0; i < 10; i++) driver.push(sine(0.01))
    assert.ok(mic.volume > -50)
    await mic.stop()
    assert.equal(mic.volume, -Infinity)
    assert.equal(mic.isStarted, false)
  })
})

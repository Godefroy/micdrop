import type { TTS } from '@micdrop/server'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { AudioMeter, BYTES_PER_SECOND, saveAudio } from '../audio.js'
import { hasKeys } from '../env.js'
import { captureLogs } from '../logs.js'
import { sleep, waitFor } from '../wait.js'
import { ConnectionOverrides, connectionScenarios } from './connection.js'

const SHORT = 'Hello, this is a short test of the voice.'
// Plain sentences, since a content filter (Gemini) now and then refuses one
// that sounds odd out of context
const LONG =
  'The weather today is mild, with a light breeze coming from the west. ' +
  'In the afternoon the sky clears, and the sun stays out until the evening. ' +
  'Tomorrow brings a few clouds in the morning, then a warm and sunny day. ' +
  'The weekend looks pleasant too, with gentle temperatures all along.'

export interface TTSScenarioOptions {
  /** Keys the provider needs, the scenarios are skipped without them */
  keys?: string[]
  /**
   * Whether what a local provider needs is there (a model, a binary, a
   * server), the scenarios are skipped otherwise
   */
  available?: boolean
  /** Longer than the default for a local model, which loads on first use */
  timeout?: number
  create(overrides?: ConnectionOverrides): TTS
  /** Holds a connection of its own, whose edges are tested too */
  websocket?: boolean
}

/** What every text to speech has to do in a call */
export function describeTTS(name: string, options: TTSScenarioOptions) {
  const skip = !hasKeys(...(options.keys ?? [])) || options.available === false
  describe.skipIf(skip)(name, { timeout: options.timeout }, () => {
    const instances: TTS[] = []
    const track = (tts: TTS) => instances.push(tts)
    const create = (overrides?: ConnectionOverrides) => {
      const tts = captureLogs(options.create(overrides), name)
      track(tts)
      return tts
    }
    afterEach(() => instances.splice(0).forEach((tts) => tts.destroy()))

    function speak(tts: TTS, text: string) {
      const stream = new PassThrough()
      tts.speak(stream)
      stream.end(text)
    }

    it('speaks a sentence', async () => {
      const tts = create()
      const meter = new AudioMeter(tts)
      const failures: string[][] = []
      tts.on('Failed', (texts) => failures.push(texts))

      speak(tts, SHORT)
      await meter.untilQuiet()
      saveAudio(name, meter.audio)

      expect(failures).toEqual([])
      // Around two seconds of speech, whatever the voice
      expect(meter.seconds).toBeGreaterThan(1)
      expect(meter.bytes % 2).toBe(0)
    })

    it('goes quiet as soon as it is cancelled', async () => {
      const tts = create()
      const meter = new AudioMeter(tts)

      speak(tts, LONG)
      await waitFor(() => meter.chunks > 0, 'the first audio chunk')
      tts.cancel()
      const atCancel = meter.bytes
      await sleep(3000)

      // Not a single chunk once cancelled, the provider may still be sending
      expect(meter.bytes - atCancel).toBe(0)
    })

    it('speaks the next answer after a cancel', async () => {
      const tts = create()
      const meter = new AudioMeter(tts)

      speak(tts, LONG)
      await waitFor(() => meter.chunks > 0, 'the first audio chunk')
      tts.cancel()
      await sleep(500)
      const atCancel = meter.bytes

      speak(tts, SHORT)
      await waitFor(
        () => meter.bytes - atCancel > BYTES_PER_SECOND / 2,
        'the audio of the next answer'
      )
    })

    it('lets a second answer take over without a cancel', async () => {
      const tts = create()
      const meter = new AudioMeter(tts)

      speak(tts, LONG)
      await waitFor(() => meter.chunks > 0, 'the first audio chunk')
      const atTakeOver = meter.bytes
      speak(tts, SHORT)
      // The first audio of the second answer, then its end
      await waitFor(
        () => meter.bytes - atTakeOver > BYTES_PER_SECOND / 2,
        'the audio of the second answer'
      )
      await meter.untilQuiet()

      // The short sentence alone, the rest of the long one is dropped
      const after = (meter.bytes - atTakeOver) / BYTES_PER_SECOND
      expect(after).toBeGreaterThan(1)
      expect(after).toBeLessThan(6)
    })

    it('keeps speaking through an answer without a word', async () => {
      const tts = create()
      const meter = new AudioMeter(tts)

      speak(tts, LONG)
      await waitFor(() => meter.chunks > 0, 'the first audio chunk')
      // A tool or a hook skipped the next answer, its stream ends empty
      const empty = new PassThrough()
      tts.speak(empty)
      empty.end()
      await meter.untilQuiet()

      expect(meter.seconds).toBeGreaterThan(8)
    })

    if (options.websocket) {
      describe('connection', () => {
        connectionScenarios(create, (tts) => speak(tts, SHORT), track)
      })
    }
  })
}

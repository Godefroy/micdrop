import type { STT } from '@micdrop/server'
import { PassThrough } from 'node:stream'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { canSpeak, SPEECH, speakInto, speech } from '../audio.js'
import { hasKeys } from '../env.js'
import { captureLogs } from '../logs.js'
import { sleep, waitFor } from '../wait.js'
import { ConnectionOverrides, connectionScenarios } from './connection.js'

export interface STTScenarioOptions {
  /** Keys the provider needs, the scenarios are skipped without them */
  keys?: string[]
  /**
   * Whether what a local provider needs is there (a model, a binary, a
   * server), the scenarios are skipped otherwise
   */
  available?: boolean
  /** Longer than the default for a local model, which loads on first use */
  timeout?: number
  create(overrides?: ConnectionOverrides): STT
  /** Holds a connection of its own, whose edges are tested too */
  websocket?: boolean
}

const FOX = /fox|dog/i
const PARIS = /paris|france/i
const PIZZA = /pizza/i

/**
 * Cuts the silence after the last word, below -40 dB: the client ends a turn
 * on the silence it hears, the hardest case for the end of an utterance
 */
function trimEnd(audio: Buffer): Buffer {
  let end = audio.length - 2
  while (end > 0 && Math.abs(audio.readInt16LE(end)) < 328) end -= 2
  return audio.subarray(0, end + 2)
}

/** What every speech to text has to do in a call */
export function describeSTT(name: string, options: STTScenarioOptions) {
  const skip =
    !hasKeys(...(options.keys ?? [])) ||
    options.available === false ||
    !canSpeak()
  describe.skipIf(skip)(name, { timeout: options.timeout }, () => {
    let fox: Buffer
    let paris: Buffer
    let pizza: Buffer
    beforeAll(async () => {
      fox = await speech(SPEECH.fox)
      paris = await speech(SPEECH.paris)
      pizza = await speech(SPEECH.pizza)
    })

    const instances: STT[] = []
    const track = (stt: STT) => instances.push(stt)
    const create = (overrides?: ConnectionOverrides) => {
      const stt = captureLogs(options.create(overrides), name)
      track(stt)
      return stt
    }
    afterEach(() => instances.splice(0).forEach((stt) => stt.destroy()))

    function record(stt: STT) {
      const transcripts: string[] = []
      stt.on('Transcript', (transcript) => transcripts.push(transcript))
      return transcripts
    }

    it('transcribes an utterance, once', async () => {
      const stt = create()
      const transcripts = record(stt)

      const stream = new PassThrough()
      stt.transcribe(stream)
      await speakInto(stream, fox)
      await waitFor(() => transcripts.length > 0, 'the transcript')
      await sleep(3000)

      expect(transcripts).toHaveLength(1)
      expect(transcripts[0]).toMatch(FOX)
    })

    it('gives each utterance its own transcript, in order', async () => {
      const stt = create()
      const transcripts = record(stt)

      // Each utterance starts before the previous one is transcribed, and
      // ends right after its last word
      for (const audio of [fox, paris, pizza]) {
        const stream = new PassThrough()
        stt.transcribe(stream)
        await speakInto(stream, trimEnd(audio))
      }
      await waitFor(() => transcripts.length >= 3, 'the three transcripts')
      await sleep(3000)

      expect(transcripts).toHaveLength(3)
      expect(transcripts[0]).toMatch(FOX)
      expect(transcripts[1]).toMatch(PARIS)
      expect(transcripts[2]).toMatch(PIZZA)
    })

    if (options.websocket) {
      describe('connection', () => {
        connectionScenarios(
          create,
          (stt) => {
            const stream = new PassThrough()
            stt.transcribe(stream)
            speakInto(stream, fox)
          },
          track
        )
      })
    }
  })
}

import type { Realtime } from '@micdrop/server'
import { PassThrough } from 'node:stream'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  AudioMeter,
  canSpeak,
  saveAudio,
  SPEECH,
  speakInto,
  speech,
} from '../audio.js'
import { hasKeys } from '../env.js'
import { captureLogs } from '../logs.js'
import { sleep, waitFor } from '../wait.js'

export interface RealtimeScenarioOptions {
  /** Keys the provider needs, the scenarios are skipped without them */
  keys: string[]
  create(options: { systemPrompt: string }): Realtime
}

const BRIEF = 'You are a voice assistant. Answer in one short sentence.'

/** What every speech to speech model has to do in a call */
export function describeRealtime(
  name: string,
  options: RealtimeScenarioOptions
) {
  describe.skipIf(!hasKeys(...options.keys) || !canSpeak())(name, () => {
    let question: Buffer
    beforeAll(async () => {
      question = await speech(SPEECH.question)
    })

    const instances: Realtime[] = []
    const create = () => {
      const realtime = captureLogs(
        options.create({ systemPrompt: BRIEF }),
        name
      )
      instances.push(realtime)
      return realtime
    }
    afterEach(() => instances.splice(0).forEach((model) => model.destroy()))

    /** Plays a turn of the user, the way MicdropServer drives it */
    async function ask(realtime: Realtime, audio: Buffer) {
      const stream = new PassThrough()
      realtime.startTurn(stream)
      await speakInto(stream, audio)
      realtime.endTurn()
    }

    it('answers a spoken question, after its transcript', async () => {
      const realtime = create()
      const meter = new AudioMeter(realtime)

      await ask(realtime, question)
      await waitFor(
        () => realtime.conversation.some((item) => item.role === 'assistant'),
        'the answer to be recorded'
      )

      const roles = realtime.conversation
        .filter((item) => item.role === 'user' || item.role === 'assistant')
        .map((item) => item.role)
      expect(roles).toEqual(['user', 'assistant'])
      const [user, assistant] = realtime.conversation.filter(
        (item) => item.role === 'user' || item.role === 'assistant'
      )
      expect('content' in user && user.content).toMatch(/capital|france/i)
      expect('content' in assistant && assistant.content).toMatch(/paris/i)
      await meter.untilQuiet()
      saveAudio(name, meter.audio)
      expect(meter.seconds).toBeGreaterThan(0.3)
    })

    it('goes quiet when the user interrupts', async () => {
      const realtime = create()
      const meter = new AudioMeter(realtime)

      await ask(realtime, question)
      await waitFor(() => meter.chunks > 0, 'the voice of the answer')
      // The user speaks again, then the client drops that turn
      realtime.startTurn(new PassThrough())
      const atInterruption = meter.bytes
      realtime.discardTurn()
      await sleep(3000)

      expect(meter.bytes - atInterruption).toBe(0)
    })

    it('answers the next question after an interruption', async () => {
      const realtime = create()
      const meter = new AudioMeter(realtime)

      await ask(realtime, question)
      await waitFor(() => meter.chunks > 0, 'the voice of the answer')
      realtime.startTurn(new PassThrough())
      realtime.discardTurn()
      await sleep(1000)
      const atInterruption = meter.bytes

      await ask(realtime, question)
      await waitFor(
        () => meter.bytes > atInterruption,
        'the voice of the next answer'
      )
    })
  })
}

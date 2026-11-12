import { choice, GeminiClassifier, noul, score } from '@micdrop/gemini'
import { describe, expect, it } from 'vitest'
import { canSpeak, SAMPLE_RATE, speech, SPEECH } from '../../src/audio.js'
import { hasKeys, key } from '../../src/env.js'
import { captureLogs } from '../../src/logs.js'
import {
  describeClassifier,
  QUESTIONS,
} from '../../src/scenarios/classifier.js'

describeClassifier('GeminiClassifier', {
  keys: ['GEMINI_API_KEY'],
  create: ({ apiKey }) =>
    new GeminiClassifier({
      apiKey: apiKey ?? key('GEMINI_API_KEY'),
      questions: {
        intent: choice(QUESTIONS.intent.instructions, QUESTIONS.intent.choices),
        frustration: score(QUESTIONS.frustration.instructions, [
          ...QUESTIONS.frustration.levels,
        ]),
        wantsHuman: noul(QUESTIONS.wantsHuman.instructions),
      },
    }),
  read: ({ answers }) => ({
    intent: answers.intent?.choice,
    frustration: answers.frustration?.score,
    wantsHuman: answers.wantsHuman?.noul,
  }),
})

/** PCM 16 bits mono in a WAV header, a format every model reads */
function wav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // Mono
  header.writeUInt32LE(SAMPLE_RATE, 24)
  header.writeUInt32LE(SAMPLE_RATE * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

describe.skipIf(!hasKeys('GEMINI_API_KEY') || !canSpeak())(
  'GeminiClassifier with audio',
  () => {
    it('answers about what it hears', async () => {
      const audio = wav(await speech(SPEECH.pizza))
      const classifier = new GeminiClassifier({
        apiKey: key('GEMINI_API_KEY'),
        questions: {
          food: noul('Does the speaker in the recording order food?'),
          weather: noul(
            'Does the speaker in the recording talk about the weather?'
          ),
        },
        input: () => [
          {
            type: 'audio',
            data: audio.toString('base64'),
            mime_type: 'audio/wav',
          },
        ],
      })
      captureLogs(classifier, 'GeminiClassifier')

      const classification = await classifier.classify('')
      classifier.destroy()

      expect(classification?.result.answers.food.noul).toBeGreaterThan(0.5)
      expect(classification?.result.answers.weather.noul).toBeLessThan(0.5)
    })
  }
)

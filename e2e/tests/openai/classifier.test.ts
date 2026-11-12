import { choice, OpenaiClassifier, predicate, score } from '@micdrop/openai'
import { key } from '../../src/env.js'
import {
  describeClassifier,
  QUESTIONS,
} from '../../src/scenarios/classifier.js'

describeClassifier('OpenaiClassifier', {
  keys: ['OPENAI_API_KEY'],
  create: ({ apiKey }) =>
    new OpenaiClassifier({
      apiKey: apiKey ?? key('OPENAI_API_KEY'),
      questions: {
        intent: choice(QUESTIONS.intent.instructions, QUESTIONS.intent.choices),
        frustration: score(QUESTIONS.frustration.instructions, [
          ...QUESTIONS.frustration.levels,
        ]),
        wantsHuman: predicate(QUESTIONS.wantsHuman.instructions),
      },
    }),
  read: ({ answers }) => ({
    intent: answers.intent?.choice,
    frustration: answers.frustration?.score,
    wantsHuman: answers.wantsHuman?.probability,
  }),
})

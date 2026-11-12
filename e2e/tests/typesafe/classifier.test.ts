import { choice, noul, score, TypesafeClassifier } from '@micdrop/typesafe'
import { key } from '../../src/env.js'
import {
  describeClassifier,
  QUESTIONS,
} from '../../src/scenarios/classifier.js'

describeClassifier('TypesafeClassifier', {
  keys: ['TYPESAFE_API_KEY'],
  create: ({ apiKey }) =>
    new TypesafeClassifier({
      apiKey: apiKey ?? key('TYPESAFE_API_KEY'),
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

import { OpenaiSTT } from '@micdrop/openai'
import { key } from '../../src/env.js'
import { describeSTT } from '../../src/scenarios/stt.js'

for (const model of ['gpt-live-transcribe', 'gpt-4o-transcribe']) {
  describeSTT(`OpenaiSTT ${model}`, {
    keys: ['OPENAI_API_KEY'],
    websocket: true,
    create: (overrides = {}) =>
      new OpenaiSTT({
        apiKey: key('OPENAI_API_KEY'),
        model,
        language: 'en',
        ...overrides,
      }),
  })
}

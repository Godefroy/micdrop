import { GradiumSTT } from '@micdrop/gradium'
import { key } from '../../src/env.js'
import { describeSTT } from '../../src/scenarios/stt.js'

describeSTT('GradiumSTT', {
  keys: ['GRADIUM_API_KEY'],
  websocket: true,
  create: (overrides = {}) =>
    new GradiumSTT({ apiKey: key('GRADIUM_API_KEY'), ...overrides }),
})

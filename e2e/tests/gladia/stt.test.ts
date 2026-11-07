import { GladiaSTT } from '@micdrop/gladia'
import { key } from '../../src/env.js'
import { describeSTT } from '../../src/scenarios/stt.js'

describeSTT('GladiaSTT', {
  keys: ['GLADIA_API_KEY'],
  websocket: true,
  create: (overrides = {}) =>
    new GladiaSTT({ apiKey: key('GLADIA_API_KEY'), ...overrides }),
})

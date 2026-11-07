import { createOpenAI } from '@ai-sdk/openai'
import { AiSdkAgent } from '@micdrop/ai-sdk'
import { key } from '../../src/env.js'
import { describeAgent } from '../../src/scenarios/agent.js'

describeAgent('AiSdkAgent with OpenAI', {
  keys: ['OPENAI_API_KEY'],
  create: (options) =>
    new AiSdkAgent({
      model: createOpenAI({ apiKey: key('OPENAI_API_KEY') })('gpt-5.4-mini'),
      ...options,
    }),
})

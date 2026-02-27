import { openai } from '@ai-sdk/openai'
import { MistralAgent } from '@micdrop/mistral'
import { OpenaiAgent } from '@micdrop/openai'
import { MockAgent } from '@micdrop/server'
import { AiSdkAgent } from '../../../packages/ai-sdk/dist'

// System prompt passed to the LLM
function getSystemPrompt(lang: string) {
  return `You are a voice assistant named Micdrop.
Your role is to help the user with their questions and requests.

## Instructions
- If you're first to speak, say "Hello, how can I help you today?" in ${lang} language.
- You're in a conversation, keep your answers short and helpful.
- Write all numbers and abbreviations in full.
- Write your messages in full sentences, plain text, juste one paragraph.
- Do not use formatting or Markdown.
- Do not use lists or bullet points.
- Do not use abbreviations.
- Do not use emojis.
`
}

export default {
  mock: () => new MockAgent(),

  // OpenAI
  openai: (lang: string) =>
    new OpenaiAgent({
      apiKey: process.env.OPENAI_API_KEY || '',
      model: 'gpt-5.2',
      systemPrompt: getSystemPrompt(lang),
      autoEndCall: true,
      autoSemanticTurn: true,
      autoIgnoreUserNoise: true,
    }),

  // AI SDK
  aiSdk: (lang: string) =>
    new AiSdkAgent({
      model: openai('gpt-5.2'),
      systemPrompt: getSystemPrompt(lang),
      autoEndCall: true,
      autoSemanticTurn: true,
      autoIgnoreUserNoise: true,
    }),

  // Mistral
  mistral: (lang: string) =>
    new MistralAgent({
      apiKey: process.env.MISTRAL_API_KEY || '',
      model: 'mistral-large-latest',
      systemPrompt: getSystemPrompt(lang),
      autoEndCall: true,
      autoSemanticTurn: true,
      autoIgnoreUserNoise: true,
    }),
}

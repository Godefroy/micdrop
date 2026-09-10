import { createOpenAI, openai } from '@ai-sdk/openai'
import { AiSdkAgent } from '@micdrop/ai-sdk'
import { MistralAgent } from '@micdrop/mistral'
import { OpenaiAgent } from '@micdrop/openai'
import { Agent, FallbackAgent, MockAgent } from '@micdrop/server'
import { ModelOption, ProviderRegistry } from './types'

/**
 * Any local server speaking the OpenAI protocol fits here, Ollama being the
 * usual one. LM Studio and llama.cpp answer on the same routes, so pointing
 * this at their port is enough to run them instead.
 */
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/v1'

/**
 * System prompt the demo starts from, and the one the client shows in its
 * editor. Rewriting it there changes the character of the assistant without
 * touching this file, which is the quickest way to try a persona or a task on
 * a model already running.
 */
export const DEFAULT_SYSTEM_PROMPT = `You are a voice assistant named Micdrop.
Your role is to help the user with their questions and requests.

## Instructions
- If you're first to speak, greet the user and ask how you can help.
- You're in a conversation, keep your answers short and helpful.
- Write all numbers and abbreviations in full.
- Write your messages in full sentences, plain text, juste one paragraph.
- Do not use formatting or Markdown.
- Do not use lists or bullet points.
- Do not use abbreviations.
- Do not use emojis.
`

/**
 * The prompt the LLM receives, from the one written in the client when it sent
 * one. The language stays out of the editor: a voice or a transcription model
 * locked to one language decides it here, so the line is appended after the
 * prompt rather than written into it.
 */
function getSystemPrompt(lang: string, prompt?: string) {
  const base = prompt?.trim() || DEFAULT_SYSTEM_PROMPT.trim()
  return `${base}\n- Write every message in ${lang} language.\n`
}

/** Models pulled on the machine, asked to the local server at page load. */
async function listOllamaModels(): Promise<ModelOption[]> {
  const response = await fetch(`${OLLAMA_URL}/models`)
  const data = (await response.json()) as { data?: { id: string }[] }
  return (data.data ?? []).map(({ id }) => ({ id, label: id }))
}

async function isOllamaRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${OLLAMA_URL}/models`)
    return response.ok
  } catch {
    return false
  }
}

/**
 * Conversational models, from the most capable to the fastest.
 *
 * A voice call is judged on how quickly it answers, so the list stays on the
 * models answering straight away rather than the ones reasoning first.
 */
const OPENAI_MODELS: ModelOption[] = [
  { id: 'gpt-5.2', label: 'gpt-5.2' },
  { id: 'gpt-5.4-mini', label: 'gpt-5.4-mini' },
  { id: 'gpt-4.1-mini', label: 'gpt-4.1-mini' },
]

const agents: ProviderRegistry<Agent> = {
  mock: {
    label: 'Mock',
    description: 'Canned answers, no LLM called',
    create: () => new MockAgent(),
  },

  openai: {
    label: 'OpenAI',
    requiredEnv: ['OPENAI_API_KEY'],
    models: OPENAI_MODELS,
    defaultModel: 'gpt-5.2',
    create: ({ lang, model, auto, prompt }) =>
      new OpenaiAgent({
        apiKey: process.env.OPENAI_API_KEY || '',
        model,
        systemPrompt: getSystemPrompt(lang, prompt),
        ...auto,
      }),
  },

  aiSdk: {
    label: 'AI SDK',
    description: 'OpenAI through the Vercel AI SDK',
    requiredEnv: ['OPENAI_API_KEY'],
    models: OPENAI_MODELS,
    defaultModel: 'gpt-5.2',
    create: ({ lang, model, auto, prompt }) =>
      new AiSdkAgent({
        model: openai(model || 'gpt-5.2'),
        systemPrompt: getSystemPrompt(lang, prompt),
        ...auto,
      }),
  },

  mistral: {
    label: 'Mistral',
    requiredEnv: ['MISTRAL_API_KEY'],
    models: [
      { id: 'mistral-large-latest', label: 'mistral-large-latest' },
      { id: 'mistral-medium-latest', label: 'mistral-medium-latest' },
      { id: 'ministral-8b-latest', label: 'ministral-8b-latest' },
    ],
    defaultModel: 'mistral-large-latest',
    create: ({ lang, model, auto, prompt }) =>
      new MistralAgent({
        apiKey: process.env.MISTRAL_API_KEY || '',
        model,
        systemPrompt: getSystemPrompt(lang, prompt),
        ...auto,
      }),
  },

  // Local, through the AI SDK: the Ollama daemon exposes the models pulled on
  // the machine, so the list below is whatever `ollama pull` has fetched.
  ollama: {
    label: 'Ollama',
    local: true,
    isAvailable: isOllamaRunning,
    models: listOllamaModels,
    create: ({ lang, model, auto, prompt }) =>
      new AiSdkAgent({
        // .chat() rather than the provider itself: the default of the OpenAI
        // provider is the Responses API, which a local server does not serve
        model: createOpenAI({
          baseURL: OLLAMA_URL,
          apiKey: 'ollama', // Unused, the SDK refuses to start without one
        }).chat(model || 'qwen3:4b-instruct'),
        systemPrompt: getSystemPrompt(lang, prompt),
        // Several local models reason before answering unless told otherwise,
        // which delays the first token by a few seconds. Ollama maps this to
        // its own `think` flag, and a model without a reasoning mode ignores
        // it.
        providerOptions: { openai: { reasoningEffort: 'none' } },
        // A small model answers these less reliably than a large one, and they
        // run on every turn. Turning them off from the client is the quickest
        // way to tell which one a model mishandles.
        ...auto,
      }),
  },

  fallback: {
    label: 'Fallback',
    description: 'Mistral, then OpenAI',
    requiredEnv: ['MISTRAL_API_KEY', 'OPENAI_API_KEY'],
    create: (context) =>
      new FallbackAgent({
        factories: [
          // Each one keeps its own default model, the selected one belongs to
          // the provider the client picked
          () =>
            agents.mistral.create({
              ...context,
              model: agents.mistral.defaultModel,
            }),
          () =>
            agents.openai.create({
              ...context,
              model: agents.openai.defaultModel,
            }),
        ],
      }),
  },
}

export default agents

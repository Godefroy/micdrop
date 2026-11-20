import { createOpenAI, openai } from '@ai-sdk/openai'
import { AiSdkAgent } from '@micdrop/ai-sdk'
import { GeminiAgent } from '@micdrop/gemini'
import { MistralAgent } from '@micdrop/mistral'
import { OpenaiAgent } from '@micdrop/openai'
import { Agent, FallbackAgent, MockAgent } from '@micdrop/server'
import { listedModels } from './models'
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
export function getSystemPrompt(lang: string, prompt?: string) {
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
 * The OpenAI chat models, the ones answering soonest first.
 *
 * A voice call is judged on how quickly it answers, so the recommended models
 * answer without reasoning once told to.
 */
const OPENAI_MODELS = listedModels(
  () => OpenaiAgent.listModels({ apiKey: process.env.OPENAI_API_KEY || '' }),
  ['gpt-5.2', 'gpt-5.4-mini', 'gpt-4.1-mini']
)

/**
 * The least reasoning an OpenAI model accepts, which brings its first word
 * forward: none from GPT-5.1 on, minimal for the first GPT-5 models, low for
 * the o series. The GPT-4 models do not reason and refuse the setting.
 */
function openaiReasoningEffort(model = 'gpt-5.2') {
  if (/^gpt-5(-mini|-nano)?$/.test(model)) return 'minimal' as const
  if (/^gpt-(5\.|[6-9])/.test(model)) return 'none' as const
  if (/^o\d/.test(model)) return 'low' as const
  return undefined
}

/**
 * The least reasoning a Mistral model accepts: Mistral Medium and Small can
 * skip it, Mistral Large 4 and GLM always reason. The others do not reason.
 */
function mistralReasoningEffort(model = 'mistral-medium-latest') {
  if (/^mistral-(medium|small)/.test(model)) return 'none' as const
  if (/^(mistral-large-latest|mistral-large-4|zai-glm|glm)/.test(model)) {
    return 'low' as const
  }
  return undefined
}

/**
 * The least thinking a Gemini model accepts: low for 3.8 Flash, the Pro
 * models and Gemini 4, minimal for 3.6 Flash and 3 Flash. The Flash-Lite
 * models already think at their minimum, and 2.5 reads a budget instead.
 */
function geminiThinkingLevel(model = 'gemini-3.5-flash-lite') {
  if (/^gemini-(3\.8-flash$|4-|.*-pro)/.test(model)) return 'low'
  if (/^gemini-(3\.6-flash|3-flash)/.test(model)) return 'minimal'
  return undefined
}

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
        settings: openaiReasoningEffort(model)
          ? { reasoning: { effort: openaiReasoningEffort(model) } }
          : undefined,
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
        providerOptions: {
          openai: { reasoningEffort: openaiReasoningEffort(model) },
        },
        systemPrompt: getSystemPrompt(lang, prompt),
        ...auto,
      }),
  },

  mistral: {
    label: 'Mistral',
    requiredEnv: ['MISTRAL_API_KEY'],
    // Answers in a few hundred milliseconds, where Mistral Large 4 reasons
    // before every answer
    models: listedModels(
      () =>
        MistralAgent.listModels({ apiKey: process.env.MISTRAL_API_KEY || '' }),
      ['mistral-medium-latest', 'mistral-small-latest', 'mistral-large-latest']
    ),
    defaultModel: 'mistral-medium-latest',
    create: ({ lang, model, auto, prompt }) =>
      new MistralAgent({
        apiKey: process.env.MISTRAL_API_KEY || '',
        model,
        settings: { reasoningEffort: mistralReasoningEffort(model) },
        systemPrompt: getSystemPrompt(lang, prompt),
        ...auto,
      }),
  },

  gemini: {
    label: 'Gemini',
    requiredEnv: ['GEMINI_API_KEY'],
    models: listedModels(
      () => GeminiAgent.listModels({ apiKey: process.env.GEMINI_API_KEY || '' }),
      ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.1-flash-lite']
    ),
    // Answers in about a second, where gemini-3.8-flash takes four
    defaultModel: 'gemini-3.5-flash-lite',
    create: ({ lang, model, auto, prompt }) =>
      new GeminiAgent({
        apiKey: process.env.GEMINI_API_KEY || '',
        model,
        thinkingLevel: geminiThinkingLevel(model),
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

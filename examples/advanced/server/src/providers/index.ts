import { Agent, Realtime, STT, TTS } from '@micdrop/server'
import agents, { DEFAULT_SYSTEM_PROMPT } from './agents'
import realtime from './realtime'
import speech2Text from './speech2Text'
import text2Speech from './text2Speech'
import {
  AutoOptions,
  AutoSelection,
  CallMode,
  Catalog,
  DEFAULT_AUTO_OPTIONS,
  ModelOption,
  PartCatalog,
  ProviderDefinition,
  ProviderInfo,
  ProviderRegistry,
  ProviderSelection,
} from './types'

export * from './types'
export { agents, realtime, speech2Text, text2Speech }

/** Used when the client picks nothing, and when what it picked cannot run. */
const DEFAULT_PROVIDERS = {
  agent: 'mistral',
  stt: 'gladia',
  tts: 'gradium',
  realtime: 'openai',
} as const

export interface CallSelection {
  /** Multi-providers when the client omits it */
  mode?: CallMode
  agent?: ProviderSelection
  stt?: ProviderSelection
  tts?: ProviderSelection
  realtime?: ProviderSelection
  /** The automatic prompts, left to their defaults when the client omits them. */
  auto?: AutoSelection
  /** System prompt written in the client, absent when it kept the default. */
  prompt?: string
}

export interface CallProviders {
  /** The realtime model itself in a realtime call, since it is an agent too */
  agent: Agent
  /** Absent in a realtime call, the model hears and speaks itself */
  stt?: STT
  tts?: TTS
  /** Present in a realtime call only */
  realtime?: Realtime
  /** Language of the conversation, which a single-language voice can impose. */
  lang: string
  /** The automatic prompts the agent was built with. */
  auto: AutoOptions
}

async function listModels<T>(
  definition: ProviderDefinition<T>
): Promise<ModelOption[]> {
  const { models } = definition
  if (!models) return []
  return typeof models === 'function' ? await models() : models
}

function missingEnv<T>(definition: ProviderDefinition<T>): string[] {
  return (definition.requiredEnv ?? []).filter((key) => !process.env[key])
}

async function isAvailable<T>(
  definition: ProviderDefinition<T>
): Promise<boolean> {
  if (missingEnv(definition).length > 0) return false
  if (!definition.isAvailable) return true
  try {
    return await definition.isAvailable()
  } catch {
    return false
  }
}

async function describeProvider<T>(
  id: string,
  definition: ProviderDefinition<T>
): Promise<ProviderInfo> {
  const available = await isAvailable(definition)
  return {
    id,
    label: definition.label,
    description: definition.description,
    local: definition.local,
    available,
    missingEnv: missingEnv(definition),
    // Listing the models of a provider that cannot run would fail anyway
    models: available ? await listModels(definition) : [],
    defaultModel: definition.defaultModel,
  }
}

async function describeRegistry<T>(
  registry: ProviderRegistry<T>,
  defaultId: string
): Promise<PartCatalog> {
  const providers = await Promise.all(
    Object.entries(registry).map(([id, definition]) =>
      describeProvider(id, definition)
    )
  )
  const fallback = providers.find((provider) => provider.available)
  const preferred = providers.find(
    (provider) => provider.id === defaultId && provider.available
  )
  return {
    providers,
    defaultProvider: (preferred ?? fallback)?.id ?? defaultId,
  }
}

/** Everything the client needs to fill its selects. */
export async function getCatalog(): Promise<Catalog> {
  const [agent, stt, tts, realtimeCatalog] = await Promise.all([
    describeRegistry(agents, DEFAULT_PROVIDERS.agent),
    describeRegistry(speech2Text, DEFAULT_PROVIDERS.stt),
    describeRegistry(text2Speech, DEFAULT_PROVIDERS.tts),
    describeRegistry(realtime, DEFAULT_PROVIDERS.realtime),
  ])
  return {
    agent,
    stt,
    tts,
    realtime: realtimeCatalog,
    defaultPrompt: DEFAULT_SYSTEM_PROMPT,
  }
}

interface Resolved<T> {
  definition: ProviderDefinition<T>
  model?: string
  language?: string
}

/**
 * Finds the provider to build, falling back when the selection cannot run.
 *
 * A stale page, a key removed from the environment or a daemon that stopped
 * would otherwise fail the call, and a demo that answers with something is
 * more useful than one that refuses to start.
 */
async function resolve<T>(
  registry: ProviderRegistry<T>,
  selection: ProviderSelection | undefined,
  defaultId: string
): Promise<Resolved<T>> {
  const requested = selection?.provider
  const candidates = [requested, defaultId, ...Object.keys(registry)]

  for (const id of candidates) {
    const definition = id ? registry[id] : undefined
    if (!definition) continue
    if (!(await isAvailable(definition))) continue

    const models = await listModels(definition)
    // Keep the requested model only if it belongs to the provider we resolved
    const wanted = id === requested ? selection?.model : undefined
    const model =
      models.find((option) => option.id === wanted) ??
      models.find((option) => option.id === definition.defaultModel) ??
      models[0]

    return { definition, model: model?.id, language: model?.language }
  }

  throw new Error(`No provider available for "${defaultId}"`)
}

/**
 * Builds the three parts of a call from what the client picked, or its
 * realtime model.
 *
 * A voice, and a transcription model tied to one language, both constrain the
 * conversation: an English voice has to be paired with an agent answering in
 * English, and a French transcription model only understands French. Either
 * one therefore overrides the language the client asked for, the voice first
 * since it is the part the user hears.
 */
export async function createProviders(
  selection: CallSelection,
  lang: string
): Promise<CallProviders> {
  const auto: AutoOptions = { ...DEFAULT_AUTO_OPTIONS, ...selection.auto }

  // A realtime model is the whole call, the three parts do not apply
  if (selection.mode === 'realtime') {
    const picked = await resolve(
      realtime,
      selection.realtime,
      DEFAULT_PROVIDERS.realtime
    )
    const model = picked.definition.create({
      lang,
      model: picked.model,
      auto,
      prompt: selection.prompt,
    })
    return { lang, auto, agent: model, realtime: model }
  }

  const [agent, stt, tts] = await Promise.all([
    resolve(agents, selection.agent, DEFAULT_PROVIDERS.agent),
    resolve(speech2Text, selection.stt, DEFAULT_PROVIDERS.stt),
    resolve(text2Speech, selection.tts, DEFAULT_PROVIDERS.tts),
  ])

  // Two parts locked to different languages cannot both be satisfied, so say
  // so rather than letting the call fail in a way that looks like a bad model
  if (
    tts.language &&
    stt.language &&
    !sameLanguage(tts.language, stt.language)
  ) {
    console.warn(
      `Voice speaks ${tts.language} while transcription expects ` +
        `${stt.language}, the call will understand or answer wrong`
    )
  }

  const language = tts.language ?? stt.language ?? lang

  return {
    lang: language,
    auto,
    agent: agent.definition.create({
      lang: language,
      model: agent.model,
      auto,
      prompt: selection.prompt,
    }),
    stt: stt.definition.create({ lang: language, model: stt.model, auto }),
    tts: tts.definition.create({ lang: language, model: tts.model, auto }),
  }
}

/** Compares locales on their language only, so "fr" matches "fr-FR". */
function sameLanguage(a: string, b: string): boolean {
  return a.split('-')[0] === b.split('-')[0]
}

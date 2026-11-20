/**
 * Description of the providers the demo can assemble a call from.
 *
 * The same catalog serves two purposes: the client reads it to fill the
 * selects at the top of the page, and the server reads it to build the agent,
 * the speech to text and the text to speech the client picked, or its realtime
 * model. Adding a provider therefore means adding one entry, nothing else.
 */

export interface ModelOption {
  id: string
  label: string
  /** Other names of the same model, a saved selection may use one */
  aliases?: string[]
  description?: string
  /** Can reason before answering, which the demo turns down */
  reasoning?: boolean
  /** The provider announced its end, on `shutdownDate` when known */
  deprecated?: boolean
  shutdownDate?: string
  /**
   * Language this model or voice speaks, when it only speaks one. The call
   * uses it as the language of the conversation, so picking a French voice
   * makes the agent answer in French.
   */
  language?: string
}

/**
 * A voice of a text to speech, as `listVoices()` describes it. `language` is
 * set only for a voice that speaks that language alone, which then becomes the
 * language of the call. `languages` is only shown.
 */
export interface VoiceOption extends ModelOption {
  languages?: string[]
  gender?: 'female' | 'male' | 'neutral'
  description?: string
  previewUrl?: string
  /** Made in the account, cloned or designed */
  custom?: boolean
}

/**
 * The prompts Micdrop adds to every turn, each one costing a tool call the
 * model has to answer. A small model handles them less reliably than a hosted
 * one, so the demo lets them be turned off from the client to see the
 * difference rather than editing the code.
 */
export interface AutoOptions {
  autoEndCall: boolean
  autoSemanticTurn: boolean
  autoIgnoreUserNoise: boolean
}

export const DEFAULT_AUTO_OPTIONS: AutoOptions = {
  autoEndCall: true,
  autoSemanticTurn: true,
  autoIgnoreUserNoise: true,
}

export interface ProviderContext {
  lang: string
  model?: string
  /** Only read by the text to speech providers that offer voices. */
  voice?: string
  /** Only read by the agents, the other registries ignore it. */
  auto: AutoOptions
  /** System prompt written in the client, absent when it kept the default. */
  prompt?: string
}

export interface ProviderDefinition<T> {
  label: string
  /** Shown next to the name in the select, to tell the options apart. */
  description?: string
  /** Runs on this machine rather than behind an API. */
  local?: boolean
  /** Environment variables without which the provider cannot run. */
  requiredEnv?: string[]
  /** Extra condition, for a provider needing more than an API key. */
  isAvailable?: () => boolean | Promise<boolean>
  /** Models or voices offered for this provider, possibly looked up at runtime. */
  models?: ModelOption[] | (() => ModelOption[] | Promise<ModelOption[]>)
  /** Model used when the client picked the provider but no model. */
  defaultModel?: string
  /**
   * Voices offered for this provider and model, looked up when the client
   * asks for them rather than with the catalog, since a list can be long. A
   * provider that can filter them keeps the ones speaking `lang`.
   */
  voices?: (
    model?: string,
    lang?: string
  ) => VoiceOption[] | Promise<VoiceOption[]>
  /** Voice used when the client picked none, or one the list lacks. */
  defaultVoice?: string
  create: (context: ProviderContext) => T
}

export type ProviderRegistry<T> = Record<string, ProviderDefinition<T>>

/** What the client receives for one provider. */
export interface ProviderInfo {
  id: string
  label: string
  description?: string
  local?: boolean
  available: boolean
  missingEnv: string[]
  models: ModelOption[]
  defaultModel?: string
  /** Offers voices, which the client asks for once a model is picked. */
  hasVoices: boolean
  defaultVoice?: string
}

/** What the client receives for one of the three parts of a call. */
export interface PartCatalog {
  providers: ProviderInfo[]
  defaultProvider: string
}

/**
 * How the call runs: an agent, a speech to text and a text to speech picked
 * apart, or a realtime model that hears and speaks on its own.
 */
export type CallMode = 'multi' | 'realtime'

export interface Catalog {
  agent: PartCatalog
  stt: PartCatalog
  tts: PartCatalog
  realtime: PartCatalog
  /** What the prompt editor of the client starts from, and resets to. */
  defaultPrompt: string
}

/** What the client sends back when it starts a call. */
export interface ProviderSelection {
  provider?: string
  model?: string
  voice?: string
}

/** The automatic prompts as the client sends them, all of them optional. */
export type AutoSelection = Partial<AutoOptions>

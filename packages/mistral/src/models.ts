import { cachedList, cachedModels, MicdropModel } from '@micdrop/server'

export const DEFAULT_BASE_URL = 'https://api.mistral.ai'

/** A model as the Mistral API lists it, the fields read here */
interface MistralApiModel {
  id: string
  name?: string | null
  description?: string | null
  aliases?: string[]
  capabilities: Record<string, boolean>
  deprecation?: string | null
  audio_transcription_capabilities?: { languages?: string[] } | null
}

/** Every model of the account, fetched once a day for the whole package */
function fetchAll(apiKey: string, baseUrl: string): Promise<MistralApiModel[]> {
  return cachedList(['mistral-raw-models', baseUrl], apiKey, async () => {
    const response = await fetch(`${baseUrl}/v1/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!response.ok) throw new Error(`Mistral answered ${response.status}`)
    const { data } = (await response.json()) as { data: MistralApiModel[] }
    return data
  })
}

/**
 * The models with a capability, each one once.
 *
 * The API lists every alias as a model of its own, so the aliases of a model
 * are gathered under one id: its `-latest` alias when it has one, which
 * follows the newest version, otherwise its own id.
 */
export function listMistralModels(
  component: string,
  keep: (model: MistralApiModel) => boolean,
  options: { apiKey: string; baseUrl?: string; refresh?: boolean }
): Promise<MicdropModel[]> {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  return cachedModels(
    ['mistral', component, baseUrl],
    options.apiKey,
    async () => {
      const models: MicdropModel[] = []
      const seen = new Set<string>()
      for (const model of await fetchAll(options.apiKey, baseUrl)) {
        if (!keep(model) || seen.has(model.id)) continue
        const names = [model.id, ...(model.aliases ?? [])]
        names.forEach((name) => seen.add(name))
        const id = names.find((name) => name.endsWith('-latest')) ?? model.id
        models.push({
          id,
          name: model.name || undefined,
          description: model.description || undefined,
          aliases: names.filter((name) => name !== id),
          languages:
            model.audio_transcription_capabilities?.languages ?? undefined,
          reasoning: !!model.capabilities.reasoning,
          deprecated: !!model.deprecation,
          shutdownDate: model.deprecation?.slice(0, 10) || undefined,
        })
      }
      return models
    },
    options.refresh
  )
}

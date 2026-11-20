import { cachedList, cachedModels, MicdropModel } from '@micdrop/server'

/** A model as the Gemini API lists it, the fields read here */
interface GeminiApiModel {
  name: string
  displayName?: string
  description?: string
  supportedGenerationMethods?: string[]
  thinking?: boolean
}

/** Every model of the account, fetched once a day for the whole package */
function fetchAll(apiKey: string): Promise<GeminiApiModel[]> {
  return cachedList(['gemini-raw-models'], apiKey, async () => {
    const models: GeminiApiModel[] = []
    let pageToken: string | undefined
    do {
      const params = new URLSearchParams({ pageSize: '1000', key: apiKey })
      if (pageToken) params.set('pageToken', pageToken)
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?${params}`
      )
      if (!response.ok) throw new Error(`Gemini answered ${response.status}`)
      const page = (await response.json()) as {
        models: GeminiApiModel[]
        nextPageToken?: string
      }
      models.push(...page.models)
      pageToken = page.nextPageToken
    } while (pageToken)
    return models
  })
}

/** What a model of the list is, from its name and the methods it supports */
export type GeminiModelKind = 'agent' | 'stt' | 'tts' | 'live'

/**
 * Sorts a model into the component that runs it, or none.
 *
 * Gemini does not say what a model is for beyond the methods it supports, so
 * its name settles the rest. A model the rules miss is only left out of the
 * list, and still runs when given by name.
 */
function kindOf(model: GeminiApiModel): GeminiModelKind | undefined {
  const id = model.name.replace(/^models\//, '')
  const methods = model.supportedGenerationMethods ?? []
  if (!id.startsWith('gemini-')) return undefined
  if (/-tts\b/.test(id)) return 'tts'
  if (methods.includes('bidiGenerateContent')) {
    if (id.includes('transcribe')) return 'stt'
    if (/translate|robotics/.test(id)) return undefined
    return 'live'
  }
  if (!methods.includes('generateContent')) return undefined
  if (
    /image|embedding|transcribe|robotics|computer-use|omni|nano-banana/.test(id)
  ) {
    return undefined
  }
  return 'agent'
}

/** The models of one kind, fetched once a day */
export function listGeminiModels(
  kind: GeminiModelKind,
  options: { apiKey: string; refresh?: boolean }
): Promise<MicdropModel[]> {
  return cachedModels(
    ['gemini', kind],
    options.apiKey,
    async () =>
      (await fetchAll(options.apiKey))
        .filter((model) => kindOf(model) === kind)
        .map((model) => ({
          id: model.name.replace(/^models\//, ''),
          name: model.displayName,
          description: model.description,
          reasoning: !!model.thinking,
        })),
    options.refresh
  )
}

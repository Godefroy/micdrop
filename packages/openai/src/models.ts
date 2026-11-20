import { cachedList, cachedModels, MicdropModel } from '@micdrop/server'

/** A model as the OpenAI API lists it: an id, and a shutdown date at most */
interface OpenaiApiModel {
  id: string
  shutdown_date?: string | null
}

/** Every model of the account, fetched once a day for the whole package */
function fetchAll(apiKey: string): Promise<OpenaiApiModel[]> {
  return cachedList(['openai-raw-models'], apiKey, async () => {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!response.ok) throw new Error(`OpenAI answered ${response.status}`)
    const { data } = (await response.json()) as { data: OpenaiApiModel[] }
    return data
  })
}

/** What a model of the list runs */
export type OpenaiModelKind = 'agent' | 'stt' | 'tts' | 'realtime'

// Dated snapshots of a model, such as gpt-4o-2024-08-06 or tts-1-1106: the
// list offers the model itself, which points to its latest snapshot
const SNAPSHOT = /-(\d{4}-\d{2}-\d{2}|\d{4})$/

/**
 * Sorts a model into the component that runs it, or none.
 *
 * OpenAI lists ids alone, without what a model is for, so its name settles
 * it. A model the rules miss is only left out of the list, and still runs
 * when given by name.
 */
function kindsOf(id: string): OpenaiModelKind[] {
  if (SNAPSHOT.test(id)) return []
  if (id.includes('transcribe')) return id.includes('diarize') ? [] : ['stt']
  if (id.startsWith('gpt-realtime')) {
    return /translate|whisper/.test(id) ? [] : ['realtime', 'tts']
  }
  if (id.includes('-tts') || /^tts-/.test(id)) return ['tts']
  if (!/^(gpt-[4-9]|o\d)/.test(id)) return []
  // Audio, images, search and live models are not chat models, pro and codex
  // ones only reason long
  if (/audio|image|search|live|codex|-pro\b/.test(id)) return []
  return ['agent']
}

/** The models of one kind, fetched once a day */
export function listOpenaiModels(
  kind: OpenaiModelKind,
  options: { apiKey: string; refresh?: boolean }
): Promise<MicdropModel[]> {
  return cachedModels(
    ['openai', kind],
    options.apiKey,
    async () =>
      (await fetchAll(options.apiKey))
        .filter((model) => kindsOf(model.id).includes(kind))
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((model) => ({
          id: model.id,
          // GPT-5 and later reason, and the realtime models from gpt-realtime-2
          reasoning:
            kind === 'agent'
              ? /^(o\d|gpt-([5-9]|\d{2,}))/.test(model.id)
              : /^gpt-realtime-[2-9]/.test(model.id),
          deprecated: !!model.shutdown_date,
          shutdownDate: model.shutdown_date || undefined,
        })),
    options.refresh
  )
}

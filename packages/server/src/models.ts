import { cachedList } from './lists'

/**
 * A model an agent, a speech to text or a text to speech can run, as its
 * `listModels()` describes it.
 *
 * Providers describe their models unevenly, so only `id` is always there. The
 * rest is filled when the provider says it.
 */
export interface MicdropModel {
  /** What the `model` option takes */
  id: string
  name?: string
  description?: string
  /** Other names the provider answers to for the same model */
  aliases?: string[]
  /** Languages it speaks or transcribes, as codes such as `en` or `fr-FR` */
  languages?: string[]
  /** Can reason before answering, which delays its first word */
  reasoning?: boolean
  /** The provider announced its end, `shutdownDate` says when if known */
  deprecated?: boolean
  /** Day the provider stops serving it, as `YYYY-MM-DD` */
  shutdownDate?: string
}

/**
 * Lists models once per provider, account and options, then shares the list
 * with every caller of the process for a day. See `cachedList()`.
 */
export function cachedModels(
  key: unknown[],
  apiKey: string,
  load: () => Promise<MicdropModel[]>,
  refresh = false
): Promise<MicdropModel[]> {
  return cachedList(['models', ...key], apiKey, load, refresh)
}

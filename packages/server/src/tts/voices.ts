import { cachedList } from '../lists'

/**
 * A voice a text to speech can speak with, as its `listVoices()` describes it.
 *
 * Providers describe their voices unevenly, so only `id` and `name` are always
 * there. The rest is filled when the provider says it.
 */
export interface MicdropVoice {
  /** What the `voice` option of the text to speech takes */
  id: string
  name: string
  /**
   * Languages the voice speaks, as codes such as `en` or `fr-FR`. Absent when
   * the provider does not say, or when the voice reads every language of its
   * model, as the OpenAI and Gemini voices do.
   */
  languages?: string[]
  gender?: 'female' | 'male' | 'neutral'
  description?: string
  /** Address of a short sample of the voice */
  previewUrl?: string
  /** Created in the account, cloned or designed, rather than offered to all */
  custom?: boolean
}

/** Turns the gender words providers use into the three values above */
export function voiceGender(
  value: string | null | undefined
): MicdropVoice['gender'] {
  const word = value?.toLowerCase()
  if (!word) return undefined
  if (word.startsWith('fem') || word === 'woman' || word === 'f')
    return 'female'
  if (
    word.startsWith('masc') ||
    word === 'male' ||
    word === 'man' ||
    word === 'm'
  ) {
    return 'male'
  }
  if (word.includes('neutral') || word === 'androgynous') return 'neutral'
  return undefined
}

/**
 * Lists voices once per provider, account and options, then shares the list
 * with every caller of the process for a day. See `cachedList()`.
 */
export function cachedVoices(
  key: unknown[],
  apiKey: string,
  load: () => Promise<MicdropVoice[]>,
  refresh = false
): Promise<MicdropVoice[]> {
  return cachedList(['voices', ...key], apiKey, load, refresh)
}

/**
 * The voices that speak a language, `fr` or `fr-FR` alike: a voice of any
 * French locale counts. A voice declaring no language reads them all, so it
 * stays in the list.
 */
export function voicesForLanguage(
  voices: MicdropVoice[],
  language: string | undefined
): MicdropVoice[] {
  if (!language) return voices
  const base = language.split('-')[0].toLowerCase()
  return voices.filter(
    (voice) =>
      !voice.languages?.length ||
      voice.languages.some((code) => code.split('-')[0].toLowerCase() === base)
  )
}

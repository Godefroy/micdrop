import { createHash } from 'crypto'
import { SharedInstances } from '../SharedInstances'

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

// A voice list changes rarely: a day keeps every call fast, and `refresh`
// is there for a voice added a moment ago
const VOICE_LIST_TTL = 24 * 60 * 60 * 1000 // ms

const voiceLists = new SharedInstances<MicdropVoice[]>({
  ttl: VOICE_LIST_TTL,
})

/**
 * Lists voices once per provider, account and options, then shares the list
 * with every caller of the process for a day. Calls asking at the same
 * time share one request, and a failed one is not kept.
 *
 * @param key - The provider, then what changes the list besides the account
 * @param apiKey - The account, kept only as a hash
 * @param load - Fetches the list
 * @param refresh - Fetches it again, for a voice added a moment ago
 */
export function cachedVoices(
  key: unknown[],
  apiKey: string,
  load: () => Promise<MicdropVoice[]>,
  refresh = false
): Promise<MicdropVoice[]> {
  const account = createHash('sha256').update(apiKey).digest('hex')
  const id = [...key, account]
  if (refresh) voiceLists.delete(id)
  return voiceLists.load(id, load)
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

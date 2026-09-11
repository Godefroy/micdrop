/**
 * The nine speakers of the CustomVoice checkpoints, so changing speaker costs
 * nothing at runtime. Each one was recorded in the language given below, and
 * can read all ten languages the model supports.
 *
 * VoiceDesign and Base checkpoints have no preset speakers. VoiceDesign
 * generates a voice from the description in `instruct`, and Base clones the
 * voice of `refAudio`.
 */
export const QWEN_SPEAKERS = {
  Ryan: 'English',
  Aiden: 'English',
  Vivian: 'Chinese',
  Serena: 'Chinese',
  Uncle_Fu: 'Chinese',
  Dylan: 'Chinese, Beijing dialect',
  Eric: 'Chinese, Sichuan dialect',
  Ono_Anna: 'Japanese',
  Sohee: 'Korean',
} as const

export type QwenSpeaker = keyof typeof QWEN_SPEAKERS

export const QWEN_SPEAKER_NAMES = Object.keys(QWEN_SPEAKERS) as QwenSpeaker[]

/**
 * The languages the model was trained on, by their ISO 639-1 code, with the
 * name the checkpoint knows each one by.
 */
export const QWEN_LANGUAGES = {
  de: 'german',
  en: 'english',
  es: 'spanish',
  fr: 'french',
  it: 'italian',
  ja: 'japanese',
  ko: 'korean',
  pt: 'portuguese',
  ru: 'russian',
  zh: 'chinese',
} as const

export type QwenLanguageCode = keyof typeof QWEN_LANGUAGES
export type QwenLanguage = (typeof QWEN_LANGUAGES)[QwenLanguageCode]

/**
 * Turns a language into the name the checkpoint expects.
 *
 * Takes the checkpoint name (`"french"`), a code (`"fr"`) or a locale
 * (`"fr-FR"`). Anything else, or nothing, returns `"auto"`, and the model
 * detects the language from the text, which can fail on a short sentence.
 */
export function resolveLanguage(language?: string): QwenLanguage | 'auto' {
  if (!language) return 'auto'
  const value = language.toLowerCase()
  const names = Object.values(QWEN_LANGUAGES) as string[]
  if (names.includes(value)) return value as QwenLanguage
  const code = value.split(/[-_]/)[0] as QwenLanguageCode
  return QWEN_LANGUAGES[code] ?? 'auto'
}

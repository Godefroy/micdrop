import { GladiaSTT } from '@micdrop/gladia'
import { GradiumTTS } from '@micdrop/gradium'
import { OpenaiAgent } from '@micdrop/openai'
import { Lang, Localized } from '../shared/lang'
import { FIRST_LINE } from '../shared/script'
import { systemPrompt } from './prompt'

/**
 * The cold open of the arc: she hands the initiative over in the first three
 * seconds, so the user's very first move comes from them rather than from a
 * question.
 */
export function firstMessage(lang: Lang) {
  return FIRST_LINE[lang]
}

export function createAgent(lang: Lang, onBeforeAnswer: () => void) {
  return new OpenaiAgent({
    apiKey: process.env.OPENAI_API_KEY || '',
    model: 'gpt-5.2',
    // No reasoning, so the answer starts sooner
    settings: { reasoning: { effort: 'none' } },
    systemPrompt: systemPrompt(lang),
    // Talking over her is a move here, and the gesture is called off from the
    // raw audio rather than from a transcript, so a "non attends !" filtered
    // out as noise still stops her.
    autoIgnoreUserNoise: true,
    autoEndCall: true,
    onBeforeAnswer,
  })
}

/**
 * People name things they want built, so the words she is likely to be handed
 * are worth spelling out.
 */
const VOCABULARY: Localized<string[]> = {
  fr: ['aurore', 'atmosphère', 'volcan', 'banquise', 'anneaux', 'lunes'],
  en: ['aurora', 'atmosphere', 'volcano', 'ice cap', 'rings', 'moons'],
}

export function createSTT(lang: Lang) {
  return new GladiaSTT({
    apiKey: process.env.GLADIA_API_KEY || '',
    settings: {
      // One language for the whole call, so a French accent on an English word
      // stays in the language the rest of the sentence is in.
      language_config: {
        languages: [lang],
        code_switching: false,
      },
      realtime_processing: {
        custom_vocabulary: true,
        custom_vocabulary_config: {
          vocabulary: VOCABULARY[lang],
        },
      },
    },
  })
}

/**
 * A voice carries its own language, so English gets its own id when one is
 * configured and falls back to the French voice when none is.
 */
export function createTTS(lang: Lang) {
  const voiceId =
    (lang === 'en' ? process.env.GRADIUM_VOICE_ID_EN : undefined) ||
    process.env.GRADIUM_VOICE_ID ||
    ''

  return new GradiumTTS({
    apiKey: process.env.GRADIUM_API_KEY || '',
    voiceId,
  })
}

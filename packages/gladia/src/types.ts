export type GladiaLanguages =
  | 'af'
  | 'sq'
  | 'am'
  | 'ar'
  | 'hy'
  | 'as'
  | 'az'
  | 'ba'
  | 'eu'
  | 'be'
  | 'bn'
  | 'bs'
  | 'br'
  | 'bg'
  | 'ca'
  | 'zh'
  | 'hr'
  | 'cs'
  | 'da'
  | 'nl'
  | 'en'
  | 'et'
  | 'fo'
  | 'fi'
  | 'fr'
  | 'gl'
  | 'ka'
  | 'de'
  | 'el'
  | 'gu'
  | 'ht'
  | 'ha'
  | 'haw'
  | 'he'
  | 'hi'
  | 'hu'
  | 'is'
  | 'id'
  | 'it'
  | 'ja'
  | 'jv'
  | 'kn'
  | 'kk'
  | 'km'
  | 'ko'
  | 'lo'
  | 'la'
  | 'lv'
  | 'ln'
  | 'lt'
  | 'lb'
  | 'mk'
  | 'mg'
  | 'ms'
  | 'ml'
  | 'mt'
  | 'mi'
  | 'mr'
  | 'mn'
  | 'mymr'
  | 'ne'
  | 'no'
  | 'nn'
  | 'oc'
  | 'ps'
  | 'fa'
  | 'pl'
  | 'pt'
  | 'pa'
  | 'ro'
  | 'ru'
  | 'sa'
  | 'sr'
  | 'sn'
  | 'sd'
  | 'si'
  | 'sk'
  | 'sl'
  | 'so'
  | 'es'
  | 'su'
  | 'sw'
  | 'sv'
  | 'tl'
  | 'tg'
  | 'ta'
  | 'tt'
  | 'te'
  | 'th'
  | 'bo'
  | 'tr'
  | 'tk'
  | 'uk'
  | 'ur'
  | 'uz'
  | 'vi'
  | 'cy'
  | 'yi'
  | 'yo'
  | 'jp'

export interface GladiaLiveSessionPayload {
  encoding: 'wav/pcm' | 'wav/alaw' | 'wav/ulaw'
  sample_rate: 8000 | 16000 | 32000 | 44100 | 48000
  bit_depth: 8 | 16 | 24 | 32
  channels: number
  custom_metadata: Record<string, any>
  model: 'solaria-1'
  endpointing: number
  maximum_duration_without_endpointing: number
  language_config: {
    languages: GladiaLanguages[]
    code_switching: boolean
  }
  pre_processing: {
    audio_enhancer: boolean
    speech_threshold: number
  }
  realtime_processing: {
    words_accurate_timestamps: boolean
    custom_vocabulary: boolean
    custom_vocabulary_config: {
      vocabulary: Array<
        | string
        | {
            value: string
            pronunciations?: string[]
            intensity?: number
            language?: GladiaLanguages
          }
      >
      default_intensity: number
    }
    custom_spelling: boolean
    custom_spelling_config: {
      spelling_dictionary: {
        [key: string]: string[]
      }
    }
    translation: boolean
    translation_config: {
      target_languages: GladiaLanguages[]
      model: 'base' | 'enhanced'
      match_original_utterances: boolean
      lipsync: boolean
      context_adaptation: boolean
      context: string
    }
    named_entity_recognition: boolean
    sentiment_analysis: boolean
  }
  post_processing: {
    summarization: boolean
    summarization_config: {
      type: 'general' | 'bullet_points' | 'concise'
    }
    chapterization: boolean
  }
  messages_config: {
    receive_partial_transcripts: boolean
    receive_final_transcripts: boolean
    receive_speech_events: boolean
    receive_pre_processing_events: boolean
    receive_realtime_processing_events: boolean
    receive_post_processing_events: boolean
    receive_acknowledgments: boolean
    receive_errors: boolean
    receive_lifecycle_events: boolean
  }
  callback: boolean
  callback_config: {
    url: string
    receive_final_transcripts: boolean
    receive_speech_events: boolean
    receive_pre_processing_events: boolean
    receive_realtime_processing_events: boolean
    receive_post_processing_events: boolean
    receive_acknowledgments: boolean
    receive_errors: boolean
    receive_lifecycle_events: boolean
  }
}

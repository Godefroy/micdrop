/**
 * Language field of a transcription model, in a Realtime session
 *
 * @see https://developers.openai.com/api/docs/guides/realtime-transcription
 * @see https://developers.openai.com/api/docs/deprecations
 *
 * gpt-transcribe and gpt-live-transcribe, which replace whisper-1 and the
 * gpt-4o-*-transcribe models (shut down on February 26, 2027), take a list of
 * expected languages. The models they replace take a single language and
 * reject the list.
 */
export function transcriptionLanguage(model: string, language?: string) {
  if (!language) return {}
  return isListingLanguages(model) ? { languages: [language] } : { language }
}

function isListingLanguages(model: string) {
  return (
    model.startsWith('gpt-transcribe') ||
    model.startsWith('gpt-live-transcribe')
  )
}

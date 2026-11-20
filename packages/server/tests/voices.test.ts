import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { cachedVoices, voiceGender, voicesForLanguage } from '../src/index'

describe('voiceGender', () => {
  it('reads the words providers use', () => {
    assert.equal(voiceGender('female'), 'female')
    assert.equal(voiceGender('feminine'), 'female')
    assert.equal(voiceGender('Male'), 'male')
    assert.equal(voiceGender('masculine'), 'male')
    assert.equal(voiceGender('gender_neutral'), 'neutral')
    assert.equal(voiceGender(null), undefined)
    assert.equal(voiceGender('unknown'), undefined)
  })
})

describe('cachedVoices', () => {
  it('fetches once per account, and again when asked to', async () => {
    let loads = 0
    const load = async () => [{ id: `voice-${++loads}`, name: 'Voice' }]
    const list = (apiKey: string, refresh?: boolean) =>
      cachedVoices(['test-provider'], apiKey, load, refresh)

    const [first, second] = await Promise.all([list('a'), list('a')])
    assert.equal(first, second)
    assert.equal(loads, 1)
    assert.equal((await list('b'))[0].id, 'voice-2')
    assert.equal((await list('a'))[0].id, 'voice-1')
    assert.equal((await list('a', true))[0].id, 'voice-3')
  })
})

describe('voicesForLanguage', () => {
  it('keeps the voices of any locale of the language, and the multilingual ones', () => {
    const voices = [
      { id: 'fr-fr', name: 'A', languages: ['fr-FR'] },
      { id: 'fr-ca', name: 'B', languages: ['fr-CA'] },
      { id: 'en', name: 'C', languages: ['en', 'fr'] },
      { id: 'de', name: 'D', languages: ['de-DE'] },
      { id: 'any', name: 'E' },
    ]
    const ids = (language?: string) =>
      voicesForLanguage(voices, language).map((voice) => voice.id)
    assert.deepEqual(ids('fr-FR'), ['fr-fr', 'fr-ca', 'en', 'any'])
    assert.deepEqual(ids('fr'), ['fr-fr', 'fr-ca', 'en', 'any'])
    assert.deepEqual(ids(undefined), ['fr-fr', 'fr-ca', 'en', 'de', 'any'])
  })
})

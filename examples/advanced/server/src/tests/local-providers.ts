// Checks that the catalog builds a fully local call, English imposed by Kokoro.
import * as dotenv from 'dotenv'
dotenv.config()

import { createProviders } from '../providers'

async function main() {
  const { agent, stt, tts, lang } = await createProviders(
    {
      agent: { provider: 'mock' },
      stt: { provider: 'whisper', model: 'tiny' },
      tts: { provider: 'kokoro', model: 'bm_george' },
    },
    'fr-FR'
  )
  console.log({
    agent: agent.constructor.name,
    stt: stt?.constructor.name,
    tts: tts?.constructor.name,
    lang,
  })

  // An unknown provider falls back instead of failing the call
  const fallback = await createProviders(
    { tts: { provider: 'nope' }, stt: { provider: 'whisper', model: 'nope' } },
    'fr-FR'
  )
  console.log({
    tts: fallback.tts?.constructor.name,
    stt: fallback.stt?.constructor.name,
    lang: fallback.lang,
  })
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

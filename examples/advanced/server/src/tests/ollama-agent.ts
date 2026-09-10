// Checks that a small local model answers, and how it handles the tool calls
// Micdrop adds on every turn (auto end call, semantic turn, noise filtering).
//
// OLLAMA_MODEL picks the model and OLLAMA_LANG the language, so the same four
// turns compare two models, or one model in two languages:
//   OLLAMA_MODEL=hf.co/openbmb/MiniCPM5-2B-GGUF:Q4_K_M OLLAMA_LANG=en-US
import * as dotenv from 'dotenv'
dotenv.config()

import { createProviders } from '../providers'

const LANG = process.env.OLLAMA_LANG || 'fr-FR'

const TURNS_BY_LANG: Record<string, string[]> = {
  'fr-FR': [
    'Bonjour, comment ça va ?',
    'Quelle heure est-il', // Unfinished sentence: autoSemanticTurn should wait
    'euh', // Meaningless: autoIgnoreUserNoise should skip
    'Merci, au revoir !', // autoEndCall should fire
  ],
  'en-US': [
    'Hello, how are you?',
    'What time is it', // Unfinished sentence: autoSemanticTurn should wait
    'uh', // Meaningless: autoIgnoreUserNoise should skip
    'Thanks, goodbye!', // autoEndCall should fire
  ],
}

const TURNS = TURNS_BY_LANG[LANG] || TURNS_BY_LANG['fr-FR']

async function main() {
  const { agent } = await createProviders(
    {
      agent: {
        provider: 'ollama',
        model: process.env.OLLAMA_MODEL || 'qwen3:4b-instruct',
      },
      tts: { provider: 'mock' },
    },
    LANG
  )
  agent.addTool({
    name: 'get_time',
    description: 'Get the current time',
    execute: () => new Date().toLocaleTimeString(LANG),
  })

  agent.on('SkipAnswer', () => console.log('   -> SkipAnswer'))
  agent.on('EndCall', () => console.log('   -> EndCall'))
  agent.on('CancelLastUserMessage', () =>
    console.log('   -> CancelLastUserMessage')
  )
  agent.on('ToolCall', (call) => console.log('   -> ToolCall', call.name))

  for (const message of TURNS) {
    console.log(`\nUser: "${message}"`)
    agent.addUserMessage(message)
    const started = Date.now()
    let firstChunk = 0
    let answer = ''
    const stream = agent.answer()
    stream.on('data', (chunk: Buffer) => {
      if (!firstChunk) firstChunk = Date.now()
      answer += chunk.toString('utf-8')
    })
    await new Promise((resolve) => stream.on('end', resolve))
    console.log(
      `   first token ${firstChunk ? firstChunk - started : '-'}ms, ` +
        `total ${Date.now() - started}ms`
    )
    console.log(`   Assistant: "${answer.trim()}"`)
  }
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

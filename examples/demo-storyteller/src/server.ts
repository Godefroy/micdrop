// Server side of the storyteller demo.
// Eleven v4 performs the audio tags the LLM writes into its answers, such as
// [whispers] or [laughs], rather than reading them out. Flash v2.5 would read
// them, so the same storyteller speaks without them there.
// https://micdrop.dev/docs/ai-integration/provided-integrations/elevenlabs

import { ElevenLabsTTS } from '@micdrop/elevenlabs'
import { OpenaiAgent, OpenaiSTT } from '@micdrop/openai'
import { handleError, MicdropServer, waitForParams } from '@micdrop/server'
import { WebSocketServer } from 'ws'
import { VOICE_MODELS, VoiceModel } from './models'

const PORT = 8099
const openaiKey = process.env.OPENAI_API_KEY || ''

const CHARACTER = `You are Ember, a storyteller sitting by a campfire at night. The user is a traveler who just sat down by your fire.
You tell a story together: you describe a scene, then ask the traveler what they do or what happens next, and the story follows their choices. You react to what they say with feeling.

Your answers are spoken out loud:
- Keep each answer to two to four sentences, then hand the story back to the traveler.
- Write plain text, with no formatting, no lists and no emojis.
- Write numbers in full.`

const WITH_TAGS = `Your voice performs audio tags: short directions in square brackets, placed right before the words they change. Use one to three in each answer, where they bring the scene to life:
- How you speak: [whispers], [excited], [curious], [mischievously], [nervously], [shouts]
- How you react: [laughs], [chuckles], [sighs], [gasps], [clears throat], [gulps]
- What the traveler hears around the fire: [fire crackling], [wolf howling in the distance], [owl hooting]
Use an ellipsis for a dramatic pause. The words of the story never go inside brackets.`

const WITHOUT_TAGS = `Your voice reads out every character you write, so never write anything in square brackets. Carry the emotion with your words alone.`

// Spoken right away, so the call opens on the voice rather than on the LLM
const FIRST_MESSAGE = {
  withTags:
    '[clears throat] Ah, a traveler! Come, sit by the fire. [mischievously] I know a story or two... Would you like a scary one, or a funny one? [whispers] Choose carefully.',
  withoutTags:
    'Ah, a traveler! Come, sit by the fire. I know a story or two. Would you like a scary one, or a funny one? Choose carefully.',
}

const server = new WebSocketServer({ port: PORT })

server.on('connection', async (socket) => {
  try {
    // The page picks the voice model, which is set up when the call opens
    // https://micdrop.dev/docs/server/auth-and-parameters
    const { model } = await waitForParams(socket, validateParams)
    console.log(
      `Call with ${model.id}, ${model.tags ? 'with' : 'without'} tags`
    )

    // One call per connection.
    // https://micdrop.dev/docs/server/installation
    new MicdropServer(socket, {
      firstMessage: model.tags
        ? FIRST_MESSAGE.withTags
        : FIRST_MESSAGE.withoutTags,

      // The storyteller, told to write tags only for a voice that performs them
      agent: new OpenaiAgent({
        apiKey: openaiKey,
        model: 'gpt-5.2',
        systemPrompt: `${CHARACTER}\n\n${model.tags ? WITH_TAGS : WITHOUT_TAGS}`,
      }),

      stt: new OpenaiSTT({ apiKey: openaiKey, language: 'en' }),

      // Eleven v4 streams over another WebSocket than Flash, and the model id
      // is all it takes to switch
      tts: new ElevenLabsTTS({
        apiKey: process.env.ELEVENLABS_API_KEY || '',
        voiceId: process.env.ELEVENLABS_VOICE_ID || '',
        modelId: model.id,
      }),

      // The page shows each answer as it is written, tags included
      partialMessages: true,
    })
  } catch (error) {
    handleError(socket, error)
  }
})

function validateParams(params: any): { model: VoiceModel } {
  const model = VOICE_MODELS.find(({ id }) => id === params?.model)
  if (!model) {
    throw new Error(`Unsupported voice model: ${params?.model}`)
  }
  return { model }
}

console.log(`Micdrop storyteller server listening on ws://localhost:${PORT}`)

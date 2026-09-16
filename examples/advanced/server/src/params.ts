import { MicdropError, MicdropErrorCode, waitForParams } from '@micdrop/server'
import { WebSocket } from 'ws'
import { z } from 'zod'
import { CallSelection } from './providers'
import { ToolSelection } from './tools'

// Required authorization param to start a call
const AUTHORIZATION_KEY = '1234'

// One of the three parts of a call, as picked in the client
const providerSelectionSchema = z.object({
  provider: z.string().optional(),
  model: z.string().optional(),
})

// Params schema for the call
export const callParamsSchema = z.object({
  authorization: z.string(),
  lang: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
  // The automatic prompts, ticked in the client. Absent means the defaults.
  auto: z
    .object({
      autoEndCall: z.boolean().optional(),
      autoSemanticTurn: z.boolean().optional(),
      autoIgnoreUserNoise: z.boolean().optional(),
    })
    .optional(),
  // The tools the agent is given, ticked in the client. Absent means all of
  // them.
  tools: z
    .object({
      get_time: z.boolean().optional(),
      get_weather: z.boolean().optional(),
      say_something_later: z.boolean().optional(),
    })
    .optional(),
  // Run Smart Turn here rather than in the browser, ticked in the client
  smartTurn: z.boolean().optional(),
  // System prompt written in the client. Absent, or empty, means the default
  // one the server exposes in its catalog.
  prompt: z.string().max(10000).optional(),
  // An agent, a speech to text and a text to speech, or a realtime model.
  // Absent means the first.
  mode: z.enum(['multi', 'realtime']).optional(),
  // Absent when the client did not read the catalog, the server then falls
  // back to the providers it considers its defaults
  providers: z
    .object({
      agent: providerSelectionSchema.optional(),
      stt: providerSelectionSchema.optional(),
      tts: providerSelectionSchema.optional(),
      realtime: providerSelectionSchema.optional(),
    })
    .optional(),
})
export type CallParams = z.infer<typeof callParamsSchema>

// Optional, only if we want to check authorization and/or get other params
export async function checkParams(socket: WebSocket): Promise<{
  lang: string
  selection: CallSelection
  tools: ToolSelection
  smartTurn: boolean
}> {
  // Get params from first message
  const params = await waitForParams(socket, callParamsSchema.parse)
  if (params.authorization !== AUTHORIZATION_KEY) {
    throw new MicdropError(
      MicdropErrorCode.Unauthorized,
      'Invalid authorization'
    )
  }

  return {
    lang: params.lang,
    selection: {
      mode: params.mode,
      ...params.providers,
      auto: params.auto,
      prompt: params.prompt,
    },
    tools: params.tools ?? {},
    smartTurn: params.smartTurn ?? false,
  }
}

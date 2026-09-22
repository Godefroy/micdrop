import { OpenaiSTT } from '@micdrop/openai'
import {
  handleError,
  Logger,
  MicdropServer,
  MicdropTurnInput,
} from '@micdrop/server'
import { TypesafeClassifier } from '@micdrop/typesafe'
import { FastifyInstance } from 'fastify'
import { toMode } from '../shared/modes'
import { Game, opening } from './Game'
import { buildState, JevResult, QUESTIONS } from './questions'

/**
 * No agent and no voice: what the user says is transcribed, Jev answers each
 * question about the secret, and the server writes the answer back. The
 * secret never leaves the server before the game ends.
 */
export default async (app: FastifyInstance) => {
  app.get('/call', { websocket: true }, async (socket, request) => {
    try {
      // The page picks a thing or a person in the URL
      const mode = toMode((request.query as { mode?: string }).mode)
      let game = new Game(mode)

      // Jev reads each turn next to the secret
      const classifier = new TypesafeClassifier({
        apiKey: process.env.TYPESAFE_API_KEY || '',
        questions: QUESTIONS,
        state: (input) =>
          buildState(input as MicdropTurnInput, game.secret.name, mode),
      })

      const server = new MicdropServer(socket, {
        firstMessage: opening(mode),
        stt: new OpenaiSTT({ apiKey: process.env.OPENAI_API_KEY || '' }),
        classifier,
      })

      // Without an agent, the game writes the answers itself. They go into
      // the conversation, so Jev reads the last one in `history`.
      const say = ([text, reply]: [string, object]) =>
        server.addAssistantMessage(text, reply)

      classifier.on('Classification', (classification) => {
        const jev = classification as typeof classification & {
          result: JevResult
          input: MicdropTurnInput
        }
        if (jev.result.answers.intent.choice === 'new_game') {
          game = new Game(mode, game.secret)
          say(game.start())
          return
        }
        game.play(jev).forEach(say)
      })

      if (process.env.DEBUG) {
        server.logger = new Logger('MicdropServer')
        classifier.logger = new Logger('Jev')
      }
    } catch (error) {
      handleError(socket, error)
    }
  })
}

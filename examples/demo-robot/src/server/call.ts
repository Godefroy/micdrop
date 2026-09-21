import { OpenaiSTT } from '@micdrop/openai'
import { handleError, Logger, MicdropServer } from '@micdrop/server'
import { TypesafeClassifier } from '@micdrop/typesafe'
import { FastifyInstance } from 'fastify'
import { QUESTIONS } from '../shared/commands'

/**
 * No agent and no voice: what the user says is transcribed, Jev turns each
 * turn into a command, and the browser plays it out.
 */
export default async (app: FastifyInstance) => {
  app.get('/call', { websocket: true }, async (socket) => {
    try {
      const classifier = new TypesafeClassifier({
        apiKey: process.env.TYPESAFE_API_KEY || '',
        questions: QUESTIONS,
      })

      const server = new MicdropServer(socket, {
        stt: new OpenaiSTT({ apiKey: process.env.OPENAI_API_KEY || '' }),
        classifier,
        classifierOptions: { sendToClient: true },
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

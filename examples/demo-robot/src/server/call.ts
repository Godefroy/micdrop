import { OpenaiSTT } from '@micdrop/openai'
import { handleError, Logger, MicdropServer } from '@micdrop/server'
import { FastifyInstance } from 'fastify'
import { brainFor } from './brains'

/**
 * No agent and no voice: what the user says is transcribed, Jev turns each
 * turn into a command, and the browser plays it out.
 */
export default async (app: FastifyInstance) => {
  app.get('/call', { websocket: true }, async (socket, request) => {
    try {
      const classifier = brainFor(request.query as Record<string, string>)

      const server = new MicdropServer(socket, {
        stt: new OpenaiSTT({ apiKey: process.env.OPENAI_API_KEY || '' }),
        classifier,
        classifierOptions: { sendToClient: true },
      })

      if (process.env.DEBUG) {
        server.logger = new Logger('MicdropServer')
        classifier.logger = new Logger('Classifier')
      }
    } catch (error) {
      handleError(socket, error)
    }
  })
}

import { OpenaiAgent, OpenaiSTT, OpenaiTTS } from '@micdrop/openai'
import {
  getTurnClassification,
  handleError,
  Logger,
  MicdropServer,
} from '@micdrop/server'
import { TypesafeClassifier } from '@micdrop/typesafe'
import { FastifyInstance } from 'fastify'
import { JevResult, QUESTIONS } from '../shared/questions'
import { route } from '../shared/routing'
import {
  FIRST_MESSAGE,
  RETENTION_HINT,
  SCRIPTED,
  SYSTEM_PROMPT,
} from './prompt'

export default async (app: FastifyInstance) => {
  app.get('/call', { websocket: true }, async (socket) => {
    try {
      const apiKey = process.env.OPENAI_API_KEY || ''

      // Jev reads the turn each time a transcript lands, and the answer waits
      // for the classification of the whole turn, a few hundred ms, to route it
      const classifier = new TypesafeClassifier({
        apiKey: process.env.TYPESAFE_API_KEY || '',
        questions: QUESTIONS,
      })

      const agent = new OpenaiAgent({
        apiKey,
        model: 'gpt-5.2',
        systemPrompt: SYSTEM_PROMPT,

        // Routes the turn before the LLM writes a single token. Without a
        // classification of the whole turn, the LLM answers.
        onBeforeAnswer() {
          const classification = getTurnClassification<JevResult>(
            this.conversation
          )
          if (!classification) return

          const decision = route(classification.result.answers)
          if (decision === 'retain') this.addMessage('system', RETENTION_HINT)
          // A scripted line is spoken as the answer, without the LLM
          else if (decision !== 'llm') return SCRIPTED[decision]
        },
      })

      const server = new MicdropServer(socket, {
        firstMessage: FIRST_MESSAGE,
        agent,
        stt: new OpenaiSTT({ apiKey }),
        tts: new OpenaiTTS({ apiKey }),
        classifier,
        // The panel shows what Jev read
        classifierOptions: {
          sendToClient: true,
          // The answer waits for the classification of its turn
          waitBeforeAnswer: true,
        },
      })

      if (process.env.DEBUG) {
        server.logger = new Logger('MicdropServer')
        agent.logger = new Logger('Agent')
        classifier.logger = new Logger('Jev')
      }
    } catch (error) {
      handleError(socket, error)
    }
  })
}

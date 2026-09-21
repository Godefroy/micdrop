import { OpenaiAgent, OpenaiSTT } from '@micdrop/openai'
import {
  getTurnClassification,
  handleError,
  Logger,
  MicdropServer,
} from '@micdrop/server'
import { TypesafeClassifier } from '@micdrop/typesafe'
import { FastifyInstance } from 'fastify'
import {
  buildQuestions,
  deckState,
  describePlan,
  isEmpty,
  JevResult,
  plan,
} from '../shared/plan'
import {
  DeckUpdate,
  Slide,
  TOOL_UPDATE_SLIDES,
  updateSlidesSchema,
} from '../shared/slides'
import { applyOperations, outline } from './deck'
import { FIRST_MESSAGE, SYSTEM_PROMPT } from './prompt'

export default async (app: FastifyInstance) => {
  app.get('/call', { websocket: true }, async (socket) => {
    try {
      const apiKey = process.env.OPENAI_API_KEY || ''
      let slides: Slide[] = []

      // Jev reads each transcript next to the deck, and the interface lays out
      // its answer at once. The answer waits for it, so the LLM follows it.
      const classifier = new TypesafeClassifier({
        apiKey: process.env.TYPESAFE_API_KEY || '',
        questions: () => buildQuestions(slides),
        state: (input) => ({
          ...(input as object),
          slides: deckState(slides),
        }),
      })

      const agent = new OpenaiAgent({
        apiKey,
        model: 'gpt-5.2',
        systemPrompt: SYSTEM_PROMPT,

        // Tells the LLM the deck as numbered on screen, and what Jev read
        onBeforeAnswer() {
          const classification = getTurnClassification<JevResult>(
            this.conversation
          )
          const jev = classification && plan(classification.result, slides)

          const lines = [`Current deck:\n${outline(slides)}`]
          if (classification && jev && !isEmpty(jev)) {
            lines.push(
              `Jev read this turn in ${classification.duration} ms: ${describePlan(jev, slides)}.`
            )
          }
          this.addMessage('system', lines.join('\n\n'), { jev })
        },
      })

      agent.addTool({
        name: TOOL_UPDATE_SLIDES,
        description:
          'Adds, edits, moves and deletes slides, all at once. Slide numbers are the ones of the deck before the call.',
        inputSchema: updateSlidesSchema,
        emitOutput: true,
        execute: async ({ operations }): Promise<DeckUpdate> => {
          slides = await applyOperations(slides, operations)
          return { slides }
        },
      })

      const server = new MicdropServer(socket, {
        firstMessage: FIRST_MESSAGE,
        agent,
        // No voice: the answers are written on screen
        stt: new OpenaiSTT({ apiKey }),
        classifier,
        classifierOptions: {
          // The interface lays out the placeholders from what Jev read
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

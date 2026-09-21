import type {
  ChoiceResponse,
  NoulResponse,
  Questions,
  SystemOneResult,
} from '@micdrop/typesafe'
import { Layout, LAYOUT_NAMES, LAYOUTS, Slide, slideLabel } from './slides'

/** How many new slides a single turn can lay out ahead of the LLM */
export const MAX_ADDS = 4

const ORDINALS = ['first', 'second', 'third', 'fourth']

/**
 * Everything Jev is asked about a turn, in a single request.
 *
 * The layout questions are speculative: they are asked for four new slides
 * even when the user wants none, and the plan reads as many as needed. Each
 * existing slide gets its own question, which lets one sentence edit some
 * slides and delete others. Plain objects rather than the SDK helpers, so the
 * interface can share this file without bundling the SDK.
 */
export function buildQuestions(slides: Slide[]): Questions {
  const questions: Questions = {
    adds: {
      type: 'noul',
      instructions:
        'Does the user in `turn` ask to create one or more new slides?',
    },
    changes: {
      type: 'noul',
      instructions:
        'Does the user in `turn` ask to change or remove slides already in `slides`, rather than only to add new ones?',
    },
    addCount: {
      type: 'choice',
      instructions:
        'How many new slides does the user in `turn` ask to create?',
      criteria: { '1': null, '2': null, '3': null, '4': null, '5': null },
    },
  }

  ORDINALS.forEach((ordinal, index) => {
    questions[`layout${index + 1}`] = {
      type: 'choice',
      instructions: `Which layout fits the ${ordinal} new slide the user in \`turn\` asks for? If there are fewer new slides, answer for the last one.`,
      criteria: LAYOUTS,
    }
  })

  slides.forEach((slide, index) => {
    questions[`slide_${slide.id}`] = {
      type: 'choice',
      instructions: `What does the user in \`turn\` want done to slide ${index + 1} of \`slides\`, "${slideLabel(slide)}"?`,
      criteria: {
        keep: 'Nothing: the request is about other slides, or asks for a new slide, even one on the same topic',
        edit: 'Change it: its text, its layout, its image, or its place in the deck',
        delete: 'Remove it',
      },
    }
  })

  return questions
}

/** What Jev reads next to the turn: the deck, as the user sees it */
export function deckState(slides: Slide[]) {
  return slides.map((slide, index) => ({
    number: index + 1,
    layout: slide.layout,
    title: slideLabel(slide),
  }))
}

type Answer = NoulResponse | ChoiceResponse
export type JevResult = SystemOneResult<Record<string, any>> & {
  answers: Record<string, Answer>
}

/** What the turn asks for, decided from the answers of Jev */
export interface Plan {
  /** Layouts of the new slides, one per slide */
  adds: Layout[]
  edits: string[]
  deletes: string[]
}

export function plan(result: JevResult, slides: Slide[]): Plan {
  const answers = result.answers
  const noul = (key: string) => (answers[key] as NoulResponse | undefined)?.noul
  const choice = (key: string) =>
    (answers[key] as ChoiceResponse | undefined)?.choice

  const adds: Layout[] = []
  if ((noul('adds') ?? 0) > 0.5) {
    const count = Math.min(Number(choice('addCount') ?? 1), MAX_ADDS)
    for (let index = 0; index < count; index++) {
      const layout = choice(`layout${index + 1}`) as Layout | undefined
      adds.push(
        layout && LAYOUT_NAMES.includes(layout)
          ? layout
          : (adds[adds.length - 1] ?? 'bullets')
      )
    }
  }

  // The slide questions only count when the turn is about existing slides
  const changes = (noul('changes') ?? 0) > 0.5
  const byAction = (action: string) =>
    changes
      ? slides
          .filter((slide) => choice(`slide_${slide.id}`) === action)
          .map((slide) => slide.id)
      : []

  return { adds, edits: byAction('edit'), deletes: byAction('delete') }
}

export function isEmpty(plan: Plan) {
  return !plan.adds.length && !plan.edits.length && !plan.deletes.length
}

/** The plan in words, for the LLM and for the interface */
export function describePlan(plan: Plan, slides: Slide[]): string {
  const number = (id: string) => slides.findIndex((s) => s.id === id) + 1
  const parts: string[] = []
  if (plan.adds.length) {
    parts.push(
      `add ${plan.adds.length} slide${plan.adds.length > 1 ? 's' : ''} (${plan.adds.join(', ')})`
    )
  }
  if (plan.edits.length) {
    parts.push(`edit slide ${plan.edits.map(number).join(', ')}`)
  }
  if (plan.deletes.length) {
    parts.push(`delete slide ${plan.deletes.map(number).join(', ')}`)
  }
  return parts.join(', ')
}

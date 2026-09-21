import { z } from 'zod'

/**
 * The ten layouts a slide can take. The descriptions are read by Jev to pick
 * one from what the user says, and by the LLM to fill it.
 */
export const LAYOUTS = {
  title: 'Cover slide: a big title and a subtitle',
  section: 'Section divider: a short title opening a new part',
  bullets: 'A title and a list of 3 to 5 short points',
  'image-left':
    'An illustration on the left, a title and a paragraph on the right',
  'image-right':
    'A title and a paragraph on the left, an illustration on the right',
  'full-image': 'A full screen illustration with a title over it',
  quote: 'A quotation in big letters, with its author',
  stats: 'Key figures: 2 to 4 big numbers, each with a label',
  'two-columns':
    'A comparison: a title and two columns, each with a heading and a text',
  timeline: 'A timeline or process: a title and 3 to 5 steps',
} as const

export type Layout = keyof typeof LAYOUTS
export const LAYOUT_NAMES = Object.keys(LAYOUTS) as Layout[]

export interface SlideImage {
  url: string
  alt: string
  /** Author and source, as the source asks to credit them */
  credit: string
  creditUrl: string
}

export interface SlideItem {
  title: string
  text: string
}

export interface Slide {
  id: string
  layout: Layout
  title: string
  subtitle?: string
  body?: string
  bullets?: string[]
  quote?: string
  author?: string
  /** Figures of `stats`, columns of `two-columns`, steps of `timeline` */
  items?: SlideItem[]
  imageQuery?: string
  image?: SlideImage
}

/** How a slide is named to Jev and the LLM, a quote having no title */
export function slideLabel(slide: Slide): string {
  return slide.title || slide.quote || slide.subtitle || slide.layout
}

/** What the output of the tool carries to the interface */
export interface DeckUpdate {
  slides: Slide[]
}

export const TOOL_UPDATE_SLIDES = 'update_slides'

/**
 * One change to the deck. Every field is nullable rather than optional, since
 * OpenAI runs tool schemas in strict mode, where every property is required.
 */
const operationSchema = z.object({
  action: z.enum(['add', 'edit', 'delete']),
  slide: z
    .number()
    .nullable()
    .describe(
      'Number of the existing slide to edit or delete, as numbered before this call. Null for add.'
    ),
  position: z
    .number()
    .nullable()
    .describe(
      'Where the slide ends up in the deck after this call, 1 being the first. Null puts a new slide at the end, and keeps an edited one where it is. Set it on edit to move a slide.'
    ),
  layout: z
    .enum(LAYOUT_NAMES as [Layout, ...Layout[]])
    .nullable()
    .describe('Required for add, null on edit to keep the current one'),
  title: z
    .string()
    .nullable()
    .describe('Required when adding a slide, whatever its layout'),
  subtitle: z.string().nullable().describe('title layout'),
  body: z.string().nullable().describe('One or two sentences, image layouts'),
  bullets: z.array(z.string()).nullable().describe('bullets layout'),
  quote: z.string().nullable().describe('quote layout'),
  author: z.string().nullable().describe('quote layout'),
  items: z
    .array(z.object({ title: z.string(), text: z.string() }))
    .nullable()
    .describe(
      'stats: title is the figure and text its label. two-columns: two items. timeline: one item per step.'
    ),
  imageQuery: z
    .string()
    .nullable()
    .describe(
      'Two or three English words to search a photo, for image-left, image-right and full-image'
    ),
})

export type SlideOperation = z.infer<typeof operationSchema>

export const updateSlidesSchema = z.object({
  operations: z
    .array(operationSchema)
    .describe('Every change asked for in the turn, applied together'),
})

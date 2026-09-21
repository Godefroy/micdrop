import { randomUUID } from 'crypto'
import { Slide, SlideImage, slideLabel, SlideOperation } from '../shared/slides'

const IMAGE_LAYOUTS = ['image-left', 'image-right', 'full-image']

/**
 * Applies the operations of one tool call, which all number the slides as
 * they were before the call, so "delete 2 and edit 3" means what it says.
 * A slide given a position is placed there once the others are in order:
 * new slides at the end, the others where they were.
 */
export async function applyOperations(
  slides: Slide[],
  operations: SlideOperation[]
): Promise<Slide[]> {
  const idAt = (number: number | null) =>
    number ? slides[number - 1]?.id : undefined

  const deleted = new Set<string>()
  const edited = new Map<string, Slide>()
  const added: Slide[] = []
  const positions = new Map<string, number>()

  for (const operation of operations) {
    const id = idAt(operation.slide)
    let slide: Slide | undefined
    if (operation.action === 'delete' && id) {
      deleted.add(id)
    } else if (operation.action === 'edit' && id) {
      slide = merge(
        edited.get(id) ?? slides.find((s) => s.id === id)!,
        operation
      )
      edited.set(id, slide)
    } else if (operation.action === 'add') {
      slide = merge(
        { id: randomUUID().slice(0, 8), layout: 'bullets', title: '' },
        operation
      )
      added.push(slide)
    }
    if (slide && operation.position) positions.set(slide.id, operation.position)
  }

  // Every slide in order, the new ones at the end, then the ones given a
  // position are moved there, from the first position to the last
  const ordered = [
    ...slides
      .filter((slide) => !deleted.has(slide.id))
      .map((slide) => edited.get(slide.id) ?? slide),
    ...added,
  ]
  const next = ordered.filter((slide) => !positions.has(slide.id))
  ordered
    .filter((slide) => positions.has(slide.id))
    .sort((a, b) => positions.get(a.id)! - positions.get(b.id)!)
    .forEach((slide) => {
      const index = Math.min(
        Math.max(positions.get(slide.id)! - 1, 0),
        next.length
      )
      next.splice(index, 0, slide)
    })

  // Every illustration of the call is searched at once
  await Promise.all(
    next.map(async (slide) => {
      if (!IMAGE_LAYOUTS.includes(slide.layout) || slide.image) return
      slide.image = await searchImage(slide.imageQuery || slide.title)
    })
  )
  return next
}

/** A null field leaves the slide as it is */
function merge(slide: Slide, operation: SlideOperation): Slide {
  const next: Slide = { ...slide }
  const { action, slide: _number, position, ...fields } = operation
  for (const [key, value] of Object.entries(fields)) {
    if (value !== null) (next as any)[key] = value
  }
  // A new search replaces the illustration
  if (operation.imageQuery && operation.imageQuery !== slide.imageQuery) {
    next.image = undefined
  }
  return next
}

/**
 * The first wide photo Openverse finds for the query: Creative Commons photos
 * from Flickr, Wikimedia and others, searched without any key.
 */
async function searchImage(query: string): Promise<SlideImage | undefined> {
  if (!query) return
  const response = await fetch(
    `https://api.openverse.org/v1/images/?page_size=1&aspect_ratio=wide&q=${encodeURIComponent(query)}`
  ).catch(() => undefined)
  if (!response?.ok) return
  const { results } = (await response.json()) as { results: any[] }
  const photo = results[0]
  if (!photo) return
  return {
    url: photo.url,
    alt: photo.title ?? query,
    credit: `${photo.creator ?? 'Unknown'}, CC ${photo.license.toUpperCase()}`,
    creditUrl: photo.foreign_landing_url,
  }
}

/** The deck in a few lines, for the LLM */
export function outline(slides: Slide[]): string {
  if (!slides.length) return 'The deck is empty.'
  return slides
    .map(
      (slide, index) => `${index + 1}. [${slide.layout}] ${slideLabel(slide)}`
    )
    .join('\n')
}

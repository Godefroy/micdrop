import { MathUtils } from 'three'
import type { Direction } from '../../../shared/commands'
import { HEIGHT, TERRAIN, WIDTH } from '../../game/world'

/**
 * The garden is laid out on the ground plane, one unit per tile, centered on
 * the origin. Rows go towards the camera: "down" is +z.
 */
export function toWorld(x: number, y: number): [number, number, number] {
  return [x - WIDTH / 2 + 0.5, 0, y - HEIGHT / 2 + 0.5]
}

/** Every model faces +z, so a turn is a rotation around y */
export const FACING: Record<Direction, number> = {
  down: 0,
  right: Math.PI / 2,
  up: Math.PI,
  left: -Math.PI / 2,
}

export function tile(x: number, y: number) {
  return TERRAIN[y]?.[x]
}

/** Damps an angle the short way round */
export function dampAngle(
  current: number,
  target: number,
  lambda: number,
  delta: number
) {
  const diff =
    ((((target - current + Math.PI) % (Math.PI * 2)) + Math.PI * 2) %
      (Math.PI * 2)) -
    Math.PI
  return MathUtils.damp(current, current + diff, lambda, delta)
}

/** A seeded random, so the decor is the same on every load */
export function random(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

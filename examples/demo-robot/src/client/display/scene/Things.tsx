import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { ReactNode, useLayoutEffect, useRef } from 'react'
import { Group, MathUtils } from 'three'
import type { Effect } from '../../game/Game'
import { Entity, PETS } from '../../game/world'
import { Burst } from './Ambience'
import { dampAngle, toWorld } from './grid'
import Model from './models/Model'

/** Everything on the ground, where the game puts it */
export default function Things({
  entities,
  effects,
}: {
  entities: Entity[]
  effects: Effect[]
}) {
  return (
    <>
      {entities
        .filter((entity) => !entity.gone && !entity.held)
        .map((entity) => {
          const isPet = PETS.includes(entity.kind)
          // A pet reacting shows it at its feet, with a sound and a word
          const excited =
            isPet && effects.some((e) => e.x === entity.x && e.y === entity.y)
          // The star hovers above the chest it came out of
          const onChest =
            entity.kind === 'star' &&
            entities.some(
              (e) => e.kind === 'chest' && e.x === entity.x && e.y === entity.y
            )
          return (
            <Placed key={entity.id} x={entity.x} y={entity.y} walks={isPet}>
              <group position-y={onChest ? 0.65 : 0}>
                <Model entity={entity} excited={excited} />
              </group>
            </Placed>
          )
        })}
      {effects.map((effect) => {
        const [x, , z] = toWorld(effect.x, effect.y)
        return (
          <group key={effect.id}>
            <Burst x={x} z={z} emoji={effect.emoji} />
            <Html
              position={[x, 1.1, z]}
              zIndexRange={[25, 15]}
              pointerEvents="none"
            >
              <div className="effect animate-float-up">{effect.emoji}</div>
            </Html>
          </group>
        )
      })}
    </>
  )
}

/**
 * Glides a thing to its tile, pops it in when it appears, and for pets, hops
 * and turns them the way they walk.
 */
function Placed({
  x,
  y,
  walks,
  children,
}: {
  x: number
  y: number
  walks?: boolean
  children: ReactNode
}) {
  const group = useRef<Group>(null)
  const heading = useRef(0)
  const appear = useRef(0)

  useLayoutEffect(() => {
    group.current!.position.set(...toWorld(x, y))
    group.current!.scale.setScalar(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useFrame(({ clock }, delta) => {
    const g = group.current!
    const [tx, , tz] = toWorld(x, y)
    const dx = tx - g.position.x
    const dz = tz - g.position.z
    const moving = Math.hypot(dx, dz) > 0.03
    g.position.x = MathUtils.damp(g.position.x, tx, 9, delta)
    g.position.z = MathUtils.damp(g.position.z, tz, 9, delta)

    if (walks) {
      if (moving) heading.current = Math.atan2(dx, dz)
      g.rotation.y = dampAngle(g.rotation.y, heading.current, 8, delta)
      g.position.y = moving
        ? Math.abs(Math.sin(clock.elapsedTime * 16)) * 0.1
        : 0
    }

    appear.current = Math.min(appear.current + delta * 3, 1)
    g.scale.setScalar(easeOutBack(appear.current))
  })

  return <group ref={group}>{children}</group>
}

function easeOutBack(t: number) {
  const c = 1.7
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2)
}

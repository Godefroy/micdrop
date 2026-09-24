import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { Color, Group, MathUtils, MeshStandardMaterial } from 'three'
import { random } from '../grid'
import { PALETTE } from '../palette'

const DRY_PETALS = new Color('#b9a46e')
const FRESH_PETALS = new Color('#ffc92e')
const DRY_STEM = new Color('#8f9a58')
const FRESH_STEM = new Color('#4f9e3a')

/** The sunflower: it hangs its head until Bip waters it */
export function Flower({ watered }: { watered?: boolean }) {
  const head = useRef<Group>(null)
  const stem = useRef<Group>(null)
  // One material for all the petals, one for the stem and the leaves
  const petals = useMemo(
    () =>
      new MeshStandardMaterial({
        color: FRESH_PETALS,
        emissive: '#ffb300',
        emissiveIntensity: 0,
      }),
    []
  )
  const green = useMemo(
    () => new MeshStandardMaterial({ color: FRESH_STEM }),
    []
  )
  const fresh = useRef(watered ? 1 : 0)

  useFrame(({ clock }, delta) => {
    fresh.current = MathUtils.damp(fresh.current, watered ? 1 : 0, 2.5, delta)
    const f = fresh.current
    const sway = Math.sin(clock.elapsedTime * 1.3) * 0.04 * f
    stem.current!.rotation.set(0.35 * (1 - f), 0, sway)
    head.current!.rotation.set(1.05 * (1 - f) - 0.15 * f, 0, 0)
    head.current!.scale.setScalar(0.82 + f * 0.28)
    petals.color.lerpColors(DRY_PETALS, FRESH_PETALS, f)
    petals.emissiveIntensity = f * 0.25
    green.color.lerpColors(DRY_STEM, FRESH_STEM, f)
  })

  return (
    <group>
      {/* A mound of soil */}
      <mesh position={[0, 0.02, 0]} receiveShadow>
        <cylinderGeometry args={[0.3, 0.36, 0.08, 10]} />
        <meshStandardMaterial color="#7a5338" roughness={1} />
      </mesh>
      <group ref={stem}>
        <mesh position={[0, 0.45, 0]} material={green} castShadow>
          <cylinderGeometry args={[0.025, 0.035, 0.9, 6]} />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh
            key={side}
            position={[side * 0.11, 0.35 + side * 0.08, 0]}
            rotation={[0, 0, side * -0.8]}
            scale={[0.14, 0.05, 0.08]}
            material={green}
            castShadow
          >
            <sphereGeometry args={[1, 8, 6]} />
          </mesh>
        ))}
        <group ref={head} position={[0, 0.9, 0]}>
          <mesh rotation-x={Math.PI / 2} castShadow>
            <cylinderGeometry args={[0.13, 0.13, 0.06, 16]} />
            <meshStandardMaterial color="#6b3f1d" roughness={1} />
          </mesh>
          {Array.from({ length: 14 }, (_, index) => {
            const angle = (index / 14) * Math.PI * 2
            return (
              <mesh
                key={index}
                position={[Math.cos(angle) * 0.2, Math.sin(angle) * 0.2, -0.01]}
                rotation-z={angle - Math.PI / 2}
                scale={[0.055, 0.12, 0.018]}
                material={petals}
                castShadow
              >
                <sphereGeometry args={[1, 8, 6]} />
              </mesh>
            )
          })}
        </group>
      </group>
    </group>
  )
}

/** A pine, a little different each time */
export function Pine({ seed }: { seed: string }) {
  const group = useRef<Group>(null)
  const { scale, phase } = useMemo(() => {
    const rand = random(hash(seed))
    return { scale: 0.85 + rand() * 0.35, phase: rand() * 10 }
  }, [seed])

  useFrame(({ clock }) => {
    group.current!.rotation.z =
      Math.sin(clock.elapsedTime * 0.8 + phase) * 0.025
  })

  return (
    <group ref={group} scale={scale}>
      <mesh position={[0, 0.2, 0]} castShadow>
        <cylinderGeometry args={[0.07, 0.1, 0.4, 6]} />
        <meshStandardMaterial color={PALETTE.trunk} />
      </mesh>
      {[
        [0.58, 0.75, 0.62],
        [0.46, 0.62, 1.0],
        [0.32, 0.52, 1.34],
      ].map(([radius, height, y], index) => (
        <mesh key={index} position={[0, y, 0]} castShadow receiveShadow>
          <coneGeometry args={[radius, height, 7]} />
          <meshStandardMaterial color={PALETTE.pine[index]} flatShading />
        </mesh>
      ))}
    </group>
  )
}

/** The apple tree, round and generous */
export function AppleTree() {
  const group = useRef<Group>(null)
  const apples = useMemo(() => {
    const rand = random(5)
    return Array.from({ length: 9 }, () => {
      const theta = rand() * Math.PI * 2
      const phi = 0.4 + rand() * 1.1
      return [
        Math.sin(phi) * Math.cos(theta) * 0.62,
        1.25 + Math.cos(phi) * 0.5,
        Math.sin(phi) * Math.sin(theta) * 0.62,
      ] as [number, number, number]
    })
  }, [])

  useFrame(({ clock }) => {
    group.current!.rotation.z = Math.sin(clock.elapsedTime * 0.7) * 0.015
  })

  return (
    <group ref={group}>
      <mesh position={[0, 0.4, 0]} castShadow>
        <cylinderGeometry args={[0.09, 0.14, 0.8, 7]} />
        <meshStandardMaterial color={PALETTE.trunk} flatShading />
      </mesh>
      {[
        [0, 1.25, 0, 0.6],
        [0.35, 1.1, 0.15, 0.42],
        [-0.33, 1.12, 0.1, 0.44],
        [0.05, 1.08, -0.35, 0.42],
        [0.05, 1.55, 0.05, 0.4],
      ].map(([x, y, z, r], index) => (
        <mesh key={index} position={[x, y, z]} castShadow receiveShadow>
          <icosahedronGeometry args={[r, 1]} />
          <meshStandardMaterial
            color={PALETTE.leaves[index % PALETTE.leaves.length]}
            flatShading
          />
        </mesh>
      ))}
      {apples.map((position, index) => (
        <mesh key={index} position={position} castShadow>
          <sphereGeometry args={[0.07, 10, 8]} />
          <meshStandardMaterial color="#e63946" roughness={0.4} />
        </mesh>
      ))}
    </group>
  )
}

function hash(text: string) {
  let h = 0
  for (const char of text) h = (h * 31 + char.charCodeAt(0)) | 0
  return h
}

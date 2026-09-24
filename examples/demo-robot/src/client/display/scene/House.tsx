import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { ExtrudeGeometry, Group, Shape } from 'three'
import { toWorld } from './grid'
import { PALETTE } from './palette'

const ROOF = {
  base: 1.43,
  half: 1.26,
  rise: 1.1,
  thickness: 0.12,
  overhang: 0.35,
}

/** The cottage on its 3 × 3 tiles, its door opening on the path */
export default function House() {
  // The attic under the roof, its gable facing the garden
  const gable = useMemo(() => {
    const shape = new Shape()
    shape.moveTo(-ROOF.half, 0)
    shape.lineTo(ROOF.half, 0)
    shape.lineTo(0, ROOF.rise)
    shape.closePath()
    const geometry = new ExtrudeGeometry(shape, {
      depth: 2.2,
      bevelEnabled: false,
    })
    geometry.translate(0, 0, -1.1)
    return geometry
  }, [])
  // Each slope is hinged on the ridge and lies right on the gable
  const slope = Math.atan2(ROOF.rise, ROOF.half)
  const slopeLength = Math.hypot(ROOF.half, ROOF.rise) + ROOF.overhang

  return (
    <group position={toWorld(1, 1)}>
      {/* Stone footing */}
      <mesh position={[0, 0.08, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.6, 0.16, 2.4]} />
        <meshStandardMaterial color="#b9b1a6" roughness={1} />
      </mesh>
      {/* Walls */}
      <mesh position={[0, 0.76, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.4, 1.2, 2.2]} />
        <meshStandardMaterial color={PALETTE.wall} roughness={0.9} />
      </mesh>
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => (
          <mesh
            key={`${sx}${sz}`}
            position={[sx * 1.2, 0.76, sz * 1.1]}
            castShadow
          >
            <boxGeometry args={[0.14, 1.22, 0.14]} />
            <meshStandardMaterial color={PALETTE.timber} />
          </mesh>
        ))
      )}
      <mesh position={[0, 1.38, 0]} castShadow>
        <boxGeometry args={[2.5, 0.1, 2.3]} />
        <meshStandardMaterial color={PALETTE.timber} />
      </mesh>
      {/* Roof: two slopes over the attic, with rows of tiles */}
      <mesh
        geometry={gable}
        position={[0, ROOF.base, 0]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color={PALETTE.wall} roughness={0.9} />
      </mesh>
      {[-1, 1].map((side) => (
        <group
          key={side}
          position={[0, ROOF.base + ROOF.rise, 0]}
          rotation-z={-side * slope}
        >
          <mesh
            position={[side * (slopeLength / 2 - 0.1), ROOF.thickness / 2, 0]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[slopeLength, ROOF.thickness, 2.7]} />
            <meshStandardMaterial color={PALETTE.roof} roughness={0.8} />
          </mesh>
          {[0.35, 0.75, 1.15, 1.55].map((x) => (
            <mesh
              key={x}
              position={[x * side, ROOF.thickness + 0.015, 0]}
              castShadow
            >
              <boxGeometry args={[0.07, 0.04, 2.72]} />
              <meshStandardMaterial color={PALETTE.roofDark} roughness={0.8} />
            </mesh>
          ))}
        </group>
      ))}
      <mesh
        position={[0, ROOF.base + ROOF.rise + 0.13, 0]}
        rotation-x={Math.PI / 2}
        castShadow
      >
        <cylinderGeometry args={[0.08, 0.08, 2.8, 8]} />
        <meshStandardMaterial color={PALETTE.roofDark} />
      </mesh>
      <mesh position={[0, 1.85, 1.11]}>
        <circleGeometry args={[0.17, 20]} />
        <meshStandardMaterial
          color={PALETTE.window}
          emissive={PALETTE.window}
          emissiveIntensity={0.9}
        />
      </mesh>
      <mesh position={[0, 1.85, 1.105]}>
        <circleGeometry args={[0.22, 20]} />
        <meshStandardMaterial color={PALETTE.timber} />
      </mesh>
      {/* Chimney */}
      <mesh position={[0.72, 2.3, -0.5]} castShadow>
        <boxGeometry args={[0.36, 1.1, 0.36]} />
        <meshStandardMaterial color="#a4968a" roughness={1} />
      </mesh>
      <mesh position={[0.72, 2.88, -0.5]} castShadow>
        <boxGeometry args={[0.46, 0.1, 0.46]} />
        <meshStandardMaterial color="#8a7d72" />
      </mesh>
      <Smoke position={[0.72, 3, -0.5]} />
      {/* Door and its step */}
      <group position={[0, 0, 1.1]}>
        <mesh position={[0, 0.58, 0.02]} castShadow>
          <boxGeometry args={[0.6, 0.86, 0.06]} />
          <meshStandardMaterial color={PALETTE.timber} />
        </mesh>
        <mesh position={[0, 0.55, 0.05]}>
          <boxGeometry args={[0.48, 0.74, 0.04]} />
          <meshStandardMaterial color="#b0703f" />
        </mesh>
        <mesh position={[0.15, 0.55, 0.09]}>
          <sphereGeometry args={[0.03, 12, 12]} />
          <meshStandardMaterial
            color="#ffd166"
            metalness={0.8}
            roughness={0.3}
          />
        </mesh>
        <mesh position={[0, 0.1, 0.18]} receiveShadow castShadow>
          <boxGeometry args={[0.8, 0.08, 0.3]} />
          <meshStandardMaterial color="#b9b1a6" />
        </mesh>
      </group>
      {/* Windows, with flower boxes on the front */}
      {[-0.75, 0.75].map((x) => (
        <Window key={x} position={[x, 0.86, 1.1]} flowers />
      ))}
      {[-0.55, 0.55].map((z) => (
        <Window
          key={z}
          position={[1.2, 0.86, z]}
          rotation={[0, Math.PI / 2, 0]}
        />
      ))}
      {/* Bushes by the walls */}
      <Bush position={[-1.45, 0, 1.2]} scale={0.9} />
      <Bush position={[1.45, 0, 1.25]} scale={0.75} />
      <Bush position={[-1.4, 0, -1.2]} scale={1.1} />
    </group>
  )
}

function Window({
  position,
  rotation,
  flowers,
}: {
  position: [number, number, number]
  rotation?: [number, number, number]
  flowers?: boolean
}) {
  return (
    <group position={position} rotation={rotation}>
      <mesh position={[0, 0, 0.02]}>
        <boxGeometry args={[0.46, 0.46, 0.05]} />
        <meshStandardMaterial color={PALETTE.timber} />
      </mesh>
      <mesh position={[0, 0, 0.05]}>
        <planeGeometry args={[0.36, 0.36]} />
        <meshStandardMaterial
          color={PALETTE.window}
          emissive={PALETTE.window}
          emissiveIntensity={0.9}
        />
      </mesh>
      <mesh position={[0, 0, 0.06]}>
        <boxGeometry args={[0.03, 0.36, 0.02]} />
        <meshStandardMaterial color={PALETTE.timber} />
      </mesh>
      <mesh position={[0, 0, 0.06]}>
        <boxGeometry args={[0.36, 0.03, 0.02]} />
        <meshStandardMaterial color={PALETTE.timber} />
      </mesh>
      {flowers && (
        <group position={[0, -0.3, 0.1]}>
          <mesh castShadow>
            <boxGeometry args={[0.5, 0.1, 0.14]} />
            <meshStandardMaterial color="#9c5b3a" />
          </mesh>
          {['#ff6b8b', '#ffd166', '#ff8fab', '#c77dff', '#ff6b8b'].map(
            (color, index) => (
              <mesh key={index} position={[-0.2 + index * 0.1, 0.08, 0]}>
                <sphereGeometry args={[0.045, 8, 8]} />
                <meshStandardMaterial color={color} />
              </mesh>
            )
          )}
        </group>
      )}
    </group>
  )
}

export function Bush({
  position,
  scale = 1,
}: {
  position: [number, number, number]
  scale?: number
}) {
  return (
    <group position={position} scale={scale}>
      {[
        [0, 0.22, 0, 0.3],
        [0.22, 0.16, 0.08, 0.22],
        [-0.2, 0.15, 0.06, 0.2],
        [0.05, 0.14, 0.2, 0.18],
      ].map(([x, y, z, r], index) => (
        <mesh key={index} position={[x, y, z]} castShadow receiveShadow>
          <icosahedronGeometry args={[r, 1]} />
          <meshStandardMaterial
            color={PALETTE.leaves[index % PALETTE.leaves.length]}
            flatShading
          />
        </mesh>
      ))}
    </group>
  )
}

/** Puffs rising from the chimney, each on its own cycle */
function Smoke({ position }: { position: [number, number, number] }) {
  const group = useRef<Group>(null)

  useFrame(({ clock }) => {
    group.current?.children.forEach((puff, index) => {
      const t = (clock.elapsedTime * 0.35 + index / 4) % 1
      puff.position.set(Math.sin(t * 4 + index) * 0.12 + t * 0.3, t * 1.4, 0)
      puff.scale.setScalar(0.12 + t * 0.28)
      const material = (puff as any).material
      material.opacity = Math.sin(t * Math.PI) * 0.7
    })
  })

  return (
    <group ref={group} position={position}>
      {[0, 1, 2, 3].map((index) => (
        <mesh key={index}>
          <icosahedronGeometry args={[1, 1]} />
          <meshStandardMaterial
            color="#ffffff"
            transparent
            depthWrite={false}
            flatShading
          />
        </mesh>
      ))}
    </group>
  )
}

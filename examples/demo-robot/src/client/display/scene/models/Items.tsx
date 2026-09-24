import { Sparkles } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  MathUtils,
  Mesh,
  PointLight,
  Quaternion,
  Shape,
  Sprite,
  Vector3,
} from 'three'

export function Bucket() {
  return (
    <group>
      <mesh position={[0, 0.17, 0]} castShadow>
        <cylinderGeometry args={[0.2, 0.15, 0.34, 16, 1, true]} />
        <meshStandardMaterial
          color="#5c8fd6"
          metalness={0.5}
          roughness={0.35}
          side={2}
        />
      </mesh>
      <mesh position={[0, 0.005, 0]}>
        <cylinderGeometry args={[0.15, 0.15, 0.01, 16]} />
        <meshStandardMaterial color="#4a78b8" />
      </mesh>
      <mesh position={[0, 0.27, 0]} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[0.18, 16]} />
        <meshStandardMaterial color="#6fd3ff" roughness={0.1} />
      </mesh>
      {[0.06, 0.3].map((y) => (
        <mesh key={y} position={[0, y, 0]} rotation-x={Math.PI / 2}>
          <torusGeometry args={[0.15 + y * 0.17, 0.012, 6, 24]} />
          <meshStandardMaterial color="#3b5f96" metalness={0.6} />
        </mesh>
      ))}
      <mesh position={[0, 0.34, 0]}>
        <torusGeometry args={[0.19, 0.012, 6, 20, Math.PI]} />
        <meshStandardMaterial color="#9aa5b1" metalness={0.8} roughness={0.3} />
      </mesh>
    </group>
  )
}

const BALL_RADIUS = 0.17

/** A football, which rolls when it moves */
export function Ball() {
  const mesh = useRef<Mesh>(null)
  const last = useRef<Vector3>()
  const geometry = useMemo(() => footballGeometry(), [])

  useFrame(() => {
    const position = mesh.current!.getWorldPosition(new Vector3())
    if (last.current) {
      const move = position.clone().sub(last.current).setY(0)
      const distance = move.length()
      if (distance > 0.0001) {
        const axis = new Vector3(move.z, 0, -move.x).normalize()
        mesh.current!.quaternion.premultiply(
          new Quaternion().setFromAxisAngle(axis, distance / BALL_RADIUS)
        )
      }
    }
    last.current = position
  })

  return (
    <mesh
      ref={mesh}
      geometry={geometry}
      position={[0, BALL_RADIUS, 0]}
      castShadow
    >
      <meshStandardMaterial vertexColors flatShading roughness={0.5} />
    </mesh>
  )
}

/**
 * An icosahedron split once: the triangles around each of its twelve corners
 * are painted black, which draws the pentagons of a football.
 */
function footballGeometry() {
  const corners = new IcosahedronGeometry(1, 0).getAttribute('position')
  const cornerPoints: Vector3[] = []
  for (let i = 0; i < corners.count; i++) {
    const point = new Vector3().fromBufferAttribute(corners, i).normalize()
    if (!cornerPoints.some((p) => p.distanceTo(point) < 0.01)) {
      cornerPoints.push(point)
    }
  }

  const geometry = new IcosahedronGeometry(BALL_RADIUS, 1)
  const position = geometry.getAttribute('position')
  const colors: number[] = []
  const white = new Color('#f7f7f2')
  const black = new Color('#22252b')
  for (let i = 0; i < position.count; i += 3) {
    let isCorner = false
    for (let j = 0; j < 3; j++) {
      const point = new Vector3()
        .fromBufferAttribute(position, i + j)
        .normalize()
      if (cornerPoints.some((p) => p.distanceTo(point) < 0.01)) isCorner = true
    }
    const color = isCorner ? black : white
    for (let j = 0; j < 3; j++) colors.push(color.r, color.g, color.b)
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
  return geometry
}

export function Apple() {
  return (
    <group position={[0, 0.11, 0]}>
      <mesh scale={[1, 0.9, 1]} castShadow>
        <sphereGeometry args={[0.12, 16, 12]} />
        <meshStandardMaterial color="#e63946" roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.13, 0]}>
        <cylinderGeometry args={[0.008, 0.01, 0.06, 5]} />
        <meshStandardMaterial color="#5a3a22" />
      </mesh>
      <mesh
        position={[0.04, 0.14, 0]}
        rotation-z={-0.6}
        scale={[0.05, 0.018, 0.028]}
      >
        <sphereGeometry args={[1, 8, 6]} />
        <meshStandardMaterial color="#5fb04a" />
      </mesh>
    </group>
  )
}

export function Banana() {
  return (
    <group position={[0, 0.06, 0]} rotation={[Math.PI / 2, 0, 0.4]}>
      <mesh rotation-z={Math.PI * 0.15} castShadow>
        <torusGeometry args={[0.16, 0.045, 10, 20, Math.PI * 0.7]} />
        <meshStandardMaterial color="#ffd23f" roughness={0.5} />
      </mesh>
      <mesh
        position={[
          0.16 * Math.cos(Math.PI * 0.15),
          0.16 * Math.sin(Math.PI * 0.15),
          0,
        ]}
      >
        <sphereGeometry args={[0.022, 6, 6]} />
        <meshStandardMaterial color="#5a3a22" />
      </mesh>
    </group>
  )
}

/** A log, what is left of a pine once Bip cut it down */
export function Wood() {
  return (
    <group position={[0, 0.11, 0]} rotation={[0, 0.5, Math.PI / 2]}>
      <mesh castShadow>
        <cylinderGeometry args={[0.11, 0.11, 0.5, 10]} />
        <meshStandardMaterial
          attach="material-0"
          color="#7a4b2c"
          roughness={1}
        />
        <meshStandardMaterial attach="material-1" color="#e8c28e" />
        <meshStandardMaterial attach="material-2" color="#e8c28e" />
      </mesh>
      <mesh position={[0.08, 0.05, 0.04]} rotation-z={-0.9}>
        <cylinderGeometry args={[0.015, 0.02, 0.14, 5]} />
        <meshStandardMaterial color="#7a4b2c" />
      </mesh>
    </group>
  )
}

/** A fish, flapping its tail */
export function Fish() {
  const tail = useRef<Group>(null)
  useFrame(({ clock }) => {
    tail.current!.rotation.y = Math.sin(clock.elapsedTime * 12) * 0.5
  })

  return (
    <group position={[0, 0.1, 0]} rotation-y={Math.PI / 2}>
      <mesh scale={[0.2, 0.1, 0.06]} castShadow>
        <sphereGeometry args={[1, 14, 10]} />
        <meshStandardMaterial color="#ff8a3d" roughness={0.3} metalness={0.2} />
      </mesh>
      <group ref={tail} position={[-0.18, 0, 0]}>
        <mesh position={[-0.07, 0, 0]} rotation-z={Math.PI / 2}>
          <coneGeometry args={[0.08, 0.14, 4]} />
          <meshStandardMaterial color="#ff6b2c" flatShading />
        </mesh>
      </group>
      <mesh
        position={[0.02, 0.1, 0]}
        rotation-z={-0.3}
        scale={[0.08, 0.05, 0.01]}
      >
        <sphereGeometry args={[1, 8, 6]} />
        <meshStandardMaterial color="#ff6b2c" />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[0.12, 0.025, side * 0.05]}>
          <sphereGeometry args={[0.018, 8, 8]} />
          <meshStandardMaterial color="#1b1b1b" roughness={0.2} />
        </mesh>
      ))}
    </group>
  )
}

/** The golden star hidden in the chest */
export function Star() {
  const group = useRef<Group>(null)
  const geometry = useMemo(() => {
    const shape = new Shape()
    for (let i = 0; i < 10; i++) {
      const radius = i % 2 ? 0.11 : 0.26
      const angle = (i / 10) * Math.PI * 2 + Math.PI / 2
      const x = Math.cos(angle) * radius
      const y = Math.sin(angle) * radius
      if (i) shape.lineTo(x, y)
      else shape.moveTo(x, y)
    }
    shape.closePath()
    const star = new ExtrudeGeometry(shape, {
      depth: 0.06,
      bevelEnabled: true,
      bevelThickness: 0.03,
      bevelSize: 0.03,
      bevelSegments: 2,
    })
    star.center()
    return star
  }, [])

  useFrame(({ clock }) => {
    group.current!.rotation.y = clock.elapsedTime * 1.8
    group.current!.position.y = 0.45 + Math.sin(clock.elapsedTime * 2.4) * 0.06
  })

  return (
    <>
      <group ref={group}>
        <mesh geometry={geometry} castShadow>
          <meshStandardMaterial
            color="#ffd23f"
            emissive="#ffb300"
            emissiveIntensity={1.6}
            metalness={0.6}
            roughness={0.25}
            toneMapped={false}
          />
        </mesh>
      </group>
      <Sparkles
        count={14}
        scale={[0.8, 0.8, 0.8]}
        position={[0, 0.45, 0]}
        size={3}
        speed={0.6}
        color="#ffe08a"
      />
    </>
  )
}

/** A garden lantern, lit or not */
export function Lamp({ on }: { on?: boolean }) {
  const light = useRef<PointLight>(null)
  const bulb = useRef<Mesh>(null)
  const halo = useRef<Sprite>(null)
  const glow = useRef(on ? 1 : 0)
  const haloTexture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 64
    const ctx = canvas.getContext('2d')!
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
    gradient.addColorStop(0, 'rgba(255, 214, 140, 0.9)')
    gradient.addColorStop(1, 'rgba(255, 214, 140, 0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 64, 64)
    return new CanvasTexture(canvas)
  }, [])

  useFrame((_, delta) => {
    glow.current = MathUtils.damp(glow.current, on ? 1 : 0, 6, delta)
    light.current!.intensity = glow.current * 10
    const material = bulb.current!.material as any
    material.emissiveIntensity = 0.05 + glow.current * 8
    halo.current!.scale.setScalar(0.2 + glow.current * 1.1)
  })

  return (
    <group>
      <mesh position={[0, 0.06, 0]} castShadow>
        <cylinderGeometry args={[0.14, 0.17, 0.12, 8]} />
        <meshStandardMaterial color="#3a3f4b" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.6, 0]} castShadow>
        <cylinderGeometry args={[0.035, 0.045, 1.05, 8]} />
        <meshStandardMaterial color="#3a3f4b" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[0, 1.13, 0]}>
        <cylinderGeometry args={[0.1, 0.13, 0.04, 6]} />
        <meshStandardMaterial color="#3a3f4b" metalness={0.6} />
      </mesh>
      <mesh ref={bulb} position={[0, 1.26, 0]}>
        <sphereGeometry args={[0.1, 16, 12]} />
        <meshStandardMaterial
          color="#fff3d1"
          emissive="#ffc861"
          emissiveIntensity={0}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[0, 1.4, 0]} castShadow>
        <coneGeometry args={[0.17, 0.14, 6]} />
        <meshStandardMaterial color="#3a3f4b" metalness={0.6} roughness={0.4} />
      </mesh>
      <sprite ref={halo} position={[0, 1.26, 0]}>
        <spriteMaterial
          map={haloTexture}
          transparent
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </sprite>
      <pointLight
        ref={light}
        position={[0, 1.2, 0]}
        color="#ffc861"
        intensity={0}
        distance={6}
        decay={1.4}
      />
    </group>
  )
}

/** The treasure chest, whose lid swings open on a golden glow */
export function Chest({ open }: { open?: boolean }) {
  const lid = useRef<Group>(null)
  const light = useRef<PointLight>(null)
  const opening = useRef(open ? 1 : 0)

  useFrame((_, delta) => {
    opening.current = MathUtils.damp(opening.current, open ? 1 : 0, 4, delta)
    lid.current!.rotation.x = -opening.current * 1.9
    light.current!.intensity = opening.current * 4
  })

  const wood = <meshStandardMaterial color="#9c5b2e" roughness={0.8} />
  const gold = (
    <meshStandardMaterial color="#f2c14e" metalness={0.9} roughness={0.3} />
  )

  return (
    <group rotation-y={-0.35}>
      <mesh position={[0, 0.17, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.6, 0.34, 0.42]} />
        {wood}
      </mesh>
      {[-0.22, 0.22].map((x) => (
        <mesh key={x} position={[x, 0.17, 0]}>
          <boxGeometry args={[0.06, 0.35, 0.43]} />
          {gold}
        </mesh>
      ))}
      <mesh position={[0, 0.3, 0]}>
        <boxGeometry args={[0.52, 0.02, 0.34]} />
        <meshStandardMaterial
          color="#ffd23f"
          emissive="#ffb300"
          emissiveIntensity={2}
          toneMapped={false}
        />
      </mesh>
      <group ref={lid} position={[0, 0.34, -0.21]}>
        <mesh position={[0, 0.02, 0.21]} rotation-z={Math.PI / 2} castShadow>
          <cylinderGeometry
            args={[0.21, 0.21, 0.6, 16, 1, false, 0, Math.PI]}
          />
          {wood}
        </mesh>
        {/* The half cylinder is open below: a board closes the lid */}
        <mesh position={[0, 0.015, 0.21]}>
          <boxGeometry args={[0.6, 0.02, 0.42]} />
          <meshStandardMaterial color="#6e3f1f" roughness={0.9} />
        </mesh>
        {[-0.22, 0.22].map((x) => (
          <mesh key={x} position={[x, 0.02, 0.21]} rotation-z={Math.PI / 2}>
            <cylinderGeometry
              args={[0.215, 0.215, 0.06, 16, 1, false, 0, Math.PI]}
            />
            {gold}
          </mesh>
        ))}
        <mesh position={[0, 0.02, 0.43]}>
          <boxGeometry args={[0.1, 0.12, 0.03]} />
          {gold}
        </mesh>
      </group>
      <pointLight
        ref={light}
        position={[0, 0.6, 0.1]}
        color="#ffcf5c"
        intensity={0}
        distance={3}
      />
    </group>
  )
}

import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import { Color, InstancedMesh, Object3D, ShaderMaterial } from 'three'
import { HEIGHT, WIDTH } from '../../game/world'
import { random } from './grid'

/** Soft motion all over the garden: cloud shadows and drifting petals */
export default function Ambience() {
  return (
    <>
      <CloudShadows />
      <Petals />
    </>
  )
}

/** The shadows of clouds passing over, slow and faint */
function CloudShadows() {
  const material = useRef<ShaderMaterial>(null)
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), [])

  useFrame((_, delta) => {
    uniforms.uTime.value += delta
  })

  return (
    <mesh position={[0, 0.004, 0]} rotation-x={-Math.PI / 2}>
      <planeGeometry args={[WIDTH + 2, HEIGHT + 2]} />
      <shaderMaterial
        ref={material}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-1}
        vertexShader={
          /* glsl */ `
          varying vec2 vPosition;
          void main() {
            vPosition = position.xy;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `
        }
        fragmentShader={
          /* glsl */ `
          uniform float uTime;
          varying vec2 vPosition;

          float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
          }
          float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(
              mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
              mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
              u.y
            );
          }

          void main() {
            vec2 p = vPosition * 0.11 + vec2(uTime * 0.025, uTime * 0.012);
            float n = noise(p) * 0.6 + noise(p * 2.1 + 3.7) * 0.3 + noise(p * 4.3) * 0.1;
            float shade = smoothstep(0.52, 0.72, n);
            gl_FragColor = vec4(0.1, 0.16, 0.3, shade * 0.16);
          }
        `
        }
      />
    </mesh>
  )
}

/** Petals carried by the wind across the island */
function Petals() {
  const ref = useRef<InstancedMesh>(null)
  const petals = useMemo(() => {
    const rand = random(113)
    return Array.from({ length: 34 }, () => ({
      x: (rand() - 0.5) * (WIDTH + 4),
      z: (rand() - 0.5) * (HEIGHT + 2),
      offset: rand(),
      speed: 0.03 + rand() * 0.03,
      spin: 1 + rand() * 2,
      color: ['#ffd6e8', '#ffffff', '#ffc2d6', '#fff3c4'][
        Math.floor(rand() * 4)
      ],
    }))
  }, [])

  useLayoutEffect(() => {
    const color = new Color()
    petals.forEach((p, index) =>
      ref.current!.setColorAt(index, color.set(p.color))
    )
    ref.current!.instanceColor!.needsUpdate = true
  }, [petals])

  const dummy = useMemo(() => new Object3D(), [])
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const span = WIDTH + 4
    petals.forEach((p, index) => {
      const life = (t * p.speed + p.offset) % 1
      const x = ((p.x + life * 7 + span * 1.5) % span) - span / 2
      dummy.position.set(
        x,
        3.2 - life * 3.1 + Math.sin(t * 1.3 + index) * 0.15,
        p.z + Math.sin(t * 0.7 + index * 2) * 0.4
      )
      dummy.rotation.set(t * p.spin, t * p.spin * 0.6, Math.sin(t + index))
      dummy.scale.setScalar(Math.min(life * 8, (1 - life) * 8, 1))
      dummy.updateMatrix()
      ref.current!.setMatrixAt(index, dummy.matrix)
    })
    ref.current!.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, petals.length]}>
      <circleGeometry args={[0.045, 6]} />
      <meshStandardMaterial side={2} roughness={0.8} />
    </instancedMesh>
  )
}

const BURST_COLORS: Array<[string[], string]> = [
  [['💧', '💦'], '#8fd8ff'],
  [['💕', '❤', '💖', '😻', '🥰'], '#ff8fab'],
  [['🔥'], '#ffb347'],
  [['🪓'], '#d9b38c'],
  [['🎵'], '#c9b5ff'],
  [['✨', '🌟', '⭐'], '#ffe08a'],
]

/**
 * A puff of soft particles where something happens, tinted by what it is:
 * drops of water, hearts, sparkles, wood chips.
 */
export function Burst({
  x,
  z,
  emoji,
}: {
  x: number
  z: number
  emoji: string
}) {
  const ref = useRef<InstancedMesh>(null)
  const born = useRef<number>()
  const color = useMemo(
    () =>
      BURST_COLORS.find(([emojis]) =>
        emojis.some((e) => emoji.includes(e))
      )?.[1] ?? '#ffffff',
    [emoji]
  )
  const sparks = useMemo(() => {
    const rand = random(Math.floor(x * 97 + z * 13))
    return Array.from({ length: 14 }, () => {
      const angle = rand() * Math.PI * 2
      const speed = 0.6 + rand() * 0.9
      return {
        vx: Math.cos(angle) * speed,
        vz: Math.sin(angle) * speed,
        vy: 1.4 + rand() * 1.4,
        size: 0.03 + rand() * 0.035,
      }
    })
  }, [x, z])

  const dummy = useMemo(() => new Object3D(), [])
  // Hidden until the first frame places the sparks
  useLayoutEffect(() => {
    dummy.scale.setScalar(0)
    dummy.updateMatrix()
    sparks.forEach((_, index) => ref.current!.setMatrixAt(index, dummy.matrix))
  }, [dummy, sparks])
  useFrame(({ clock }) => {
    born.current ??= clock.elapsedTime
    const t = clock.elapsedTime - born.current
    const fade = Math.max(0, 1 - t / 1.1)
    sparks.forEach((s, index) => {
      dummy.position.set(s.vx * t, 0.5 + s.vy * t - 2.2 * t * t, s.vz * t)
      dummy.scale.setScalar(s.size * fade)
      dummy.updateMatrix()
      ref.current!.setMatrixAt(index, dummy.matrix)
    })
    ref.current!.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh
      ref={ref}
      position={[x, 0, z]}
      args={[undefined, undefined, sparks.length]}
    >
      <icosahedronGeometry args={[1, 1]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={1.4}
        toneMapped={false}
      />
    </instancedMesh>
  )
}

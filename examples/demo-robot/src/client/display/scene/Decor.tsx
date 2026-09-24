import { Sparkles } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import {
  BackSide,
  Color,
  Group,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D,
} from 'three'
import { HEIGHT, initialEntities, WIDTH } from '../../game/world'
import { random, tile, toWorld } from './grid'
import Ambience from './Ambience'
import { Bush } from './House'
import { PALETTE } from './palette'

/**
 * Everything that only makes the garden pretty: none of it is in the game,
 * and Bip walks through the grass.
 */
export default function Decor() {
  return (
    <>
      <Sky />
      <Grass />
      <Wildflowers />
      <Rim />
      <PondLife />
      <Clouds />
      <Butterflies />
      <Ambience />
      <Sparkles
        count={40}
        scale={[WIDTH, 2, HEIGHT]}
        position={[0, 1, 0]}
        size={2.5}
        speed={0.3}
        opacity={0.6}
        color="#fff6c8"
      />
    </>
  )
}

/** The grass tiles that nothing sits on at the start */
function freeTiles() {
  const taken = new Set(initialEntities().map((e) => `${e.x},${e.y}`))
  const list: Array<[number, number]> = []
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      if (tile(x, y) === '.' && !taken.has(`${x},${y}`)) list.push([x, y])
    }
  }
  return list
}

/** A soft gradient all around, bluer below since the island floats high */
function Sky() {
  const uniforms = useMemo(
    () => ({
      uTop: { value: new Color(PALETTE.sky.top) },
      uHorizon: { value: new Color(PALETTE.sky.horizon) },
      uBottom: { value: new Color(PALETTE.sky.bottom) },
    }),
    []
  )
  return (
    <mesh scale={120}>
      <sphereGeometry args={[1, 32, 16]} />
      <shaderMaterial
        side={BackSide}
        depthWrite={false}
        uniforms={uniforms}
        vertexShader={
          /* glsl */ `
          varying vec3 vDirection;
          void main() {
            vDirection = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `
        }
        fragmentShader={
          /* glsl */ `
          uniform vec3 uTop;
          uniform vec3 uHorizon;
          uniform vec3 uBottom;
          varying vec3 vDirection;
          void main() {
            float y = vDirection.y;
            vec3 color = y > 0.0
              ? mix(uHorizon, uTop, pow(y, 0.6))
              : mix(uHorizon, uBottom, pow(-y, 0.45));
            gl_FragColor = vec4(color, 1.0);
            #include <colorspace_fragment>
          }
        `
        }
      />
    </mesh>
  )
}

/** Tufts of grass swaying in the wind */
function Grass() {
  const ref = useRef<InstancedMesh>(null)
  const time = useMemo(() => ({ value: 0 }), [])
  const material = useMemo(() => {
    const m = new MeshStandardMaterial({ roughness: 1 })
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = time
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float bend = (position.y + 0.1) * 0.12;
          vec4 origin = instanceMatrix[3];
          transformed.x += sin(uTime * 1.2 + origin.x * 0.7 + origin.z * 0.5) * bend;`
        )
    }
    return m
  }, [time])

  const blades = useMemo(() => {
    const rand = random(31)
    return freeTiles().flatMap(([tx, ty]) =>
      Array.from({ length: 1 + Math.floor(rand() * 3) }, () => {
        const [x, , z] = toWorld(tx, ty)
        return {
          x: x + (rand() - 0.5) * 0.9,
          z: z + (rand() - 0.5) * 0.9,
          height: 0.5 + rand() * 0.5,
          tilt: (rand() - 0.5) * 0.5,
          angle: rand() * Math.PI,
          shade: rand(),
        }
      })
    )
  }, [])

  useLayoutEffect(() => {
    const dummy = new Object3D()
    const color = new Color()
    blades.forEach((b, index) => {
      dummy.position.set(b.x, 0.1 * b.height, b.z)
      dummy.rotation.set(0, b.angle, b.tilt)
      dummy.scale.set(1, b.height, 1)
      dummy.updateMatrix()
      ref.current!.setMatrixAt(index, dummy.matrix)
      ref.current!.setColorAt(
        index,
        color
          .set(PALETTE.grass)
          .offsetHSL(0.02 * b.shade, 0, 0.05 + b.shade * 0.05)
      )
    })
    ref.current!.instanceMatrix.needsUpdate = true
    ref.current!.instanceColor!.needsUpdate = true
  }, [blades])

  useFrame((_, delta) => {
    time.value += delta
  })

  return (
    <instancedMesh
      ref={ref}
      args={[undefined, material, blades.length]}
      receiveShadow
    >
      <coneGeometry args={[0.028, 0.2, 3]} />
    </instancedMesh>
  )
}

/** Little dots of color in the grass */
function Wildflowers() {
  const ref = useRef<InstancedMesh>(null)
  const flowers = useMemo(() => {
    const rand = random(47)
    const colors = ['#ffffff', '#ffd6e8', '#c9b6ff', '#fff3a3', '#ff9fb2']
    return freeTiles()
      .filter(() => rand() < 0.35)
      .map(([tx, ty]) => {
        const [x, , z] = toWorld(tx, ty)
        return {
          x: x + (rand() - 0.5) * 0.8,
          z: z + (rand() - 0.5) * 0.8,
          color: colors[Math.floor(rand() * colors.length)],
        }
      })
  }, [])

  useLayoutEffect(() => {
    const dummy = new Object3D()
    const color = new Color()
    flowers.forEach((f, index) => {
      dummy.position.set(f.x, 0.07, f.z)
      dummy.updateMatrix()
      ref.current!.setMatrixAt(index, dummy.matrix)
      ref.current!.setColorAt(index, color.set(f.color))
    })
    ref.current!.instanceMatrix.needsUpdate = true
    ref.current!.instanceColor!.needsUpdate = true
  }, [flowers])

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, flowers.length]}>
      <icosahedronGeometry args={[0.045, 0]} />
      <meshStandardMaterial flatShading roughness={0.8} />
    </instancedMesh>
  )
}

/** Bushes, rocks and mushrooms on the grass around the garden */
function Rim() {
  const items = useMemo(() => {
    const rand = random(59)
    const spots: Array<[number, number]> = []
    for (let x = -1; x <= WIDTH; x++) spots.push([x, -1], [x, HEIGHT])
    for (let y = 0; y < HEIGHT; y++) spots.push([-1, y], [WIDTH, y])
    return spots
      .filter(() => rand() < 0.45)
      .map(([tx, ty]) => {
        const [x, , z] = toWorld(tx, ty)
        const roll = rand()
        const kind = roll < 0.55 ? 'bush' : roll < 0.85 ? 'rock' : 'mushroom'
        return {
          kind,
          position: [x + (rand() - 0.5) * 0.4, 0, z + (rand() - 0.5) * 0.4] as [
            number,
            number,
            number,
          ],
          // The rocks behind the pond stand out against the sky
          scale: (0.6 + rand() * 0.6) * (kind === 'rock' && ty < 0 ? 1.6 : 1),
          angle: rand() * Math.PI,
        }
      })
  }, [])

  return (
    <>
      {items.map((item, index) =>
        item.kind === 'bush' ? (
          <Bush key={index} position={item.position} scale={item.scale} />
        ) : item.kind === 'rock' ? (
          <mesh
            key={index}
            position={item.position}
            rotation-y={item.angle}
            scale={[item.scale * 0.5, item.scale * 0.32, item.scale * 0.42]}
            castShadow
            receiveShadow
          >
            <dodecahedronGeometry args={[1, 0]} />
            <meshStandardMaterial color={PALETTE.rock} flatShading />
          </mesh>
        ) : (
          <Mushroom key={index} position={item.position} scale={item.scale} />
        )
      )}
    </>
  )
}

function Mushroom({
  position,
  scale,
}: {
  position: [number, number, number]
  scale: number
}) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.07, 0]} castShadow>
        <cylinderGeometry args={[0.03, 0.04, 0.14, 8]} />
        <meshStandardMaterial color="#fbf3e8" />
      </mesh>
      <mesh position={[0, 0.14, 0]} castShadow>
        <sphereGeometry args={[0.1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#e63946" roughness={0.5} />
      </mesh>
      {[0, 2.1, 4.2].map((angle) => (
        <mesh
          key={angle}
          position={[Math.cos(angle) * 0.055, 0.215, Math.sin(angle) * 0.055]}
        >
          <sphereGeometry args={[0.016, 6, 6]} />
          <meshStandardMaterial color="#ffffff" />
        </mesh>
      ))}
    </group>
  )
}

/** Lily pads floating on the pond, and reeds on its shore */
function PondLife() {
  const pads = useRef<Group>(null)
  const water = useMemo(() => {
    const list: Array<[number, number]> = []
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) if (tile(x, y) === '~') list.push([x, y])
    }
    return list
  }, [])
  const lilies = useMemo(() => {
    const rand = random(71)
    return water
      .filter(() => rand() < 0.4)
      .map(([tx, ty]) => {
        const [x, , z] = toWorld(tx, ty)
        return {
          x: x + (rand() - 0.5) * 0.5,
          z: z + (rand() - 0.5) * 0.5,
          angle: rand() * Math.PI * 2,
          size: 0.16 + rand() * 0.1,
          bloom: rand() < 0.35,
        }
      })
  }, [water])

  useFrame(({ clock }) => {
    pads.current?.children.forEach((pad, index) => {
      pad.position.y = -0.19 + Math.sin(clock.elapsedTime * 1.2 + index) * 0.008
      pad.rotation.y =
        lilies[index].angle + Math.sin(clock.elapsedTime * 0.3 + index) * 0.2
    })
  })

  return (
    <group ref={pads}>
      {lilies.map((lily, index) => (
        <group key={index} position={[lily.x, -0.19, lily.z]}>
          <mesh receiveShadow>
            <cylinderGeometry
              args={[
                lily.size,
                lily.size,
                0.015,
                20,
                1,
                false,
                0.3,
                Math.PI * 2 - 0.6,
              ]}
            />
            <meshStandardMaterial color="#4f9e3a" roughness={0.6} />
          </mesh>
          {lily.bloom && (
            <mesh position={[0.03, 0.04, 0.02]}>
              <icosahedronGeometry args={[0.05, 0]} />
              <meshStandardMaterial color="#ffb3c8" flatShading />
            </mesh>
          )}
        </group>
      ))}
    </group>
  )
}

/** A sea of puffy clouds drifting below the island */
function Clouds() {
  const group = useRef<Group>(null)
  const clouds = useMemo(() => {
    const rand = random(83)
    return Array.from({ length: 16 }, (_, index) => {
      const angle = (index / 16) * Math.PI * 2 + rand() * 0.3
      const distance = 13 + rand() * 12
      return {
        x: Math.cos(angle) * distance,
        y: -6 - rand() * 5,
        z: Math.sin(angle) * distance * 0.75,
        scale: 1.6 + rand() * 1.8,
        puffs: Array.from({ length: 4 + Math.floor(rand() * 3) }, (_, i) => [
          (i - 2) * 0.9 + (rand() - 0.5) * 0.4,
          rand() * 0.4,
          (rand() - 0.5) * 0.9,
          0.7 + rand() * 0.6,
        ]),
        speed: 0.05 + rand() * 0.08,
      }
    })
  }, [])

  useFrame(({ clock }) => {
    group.current?.children.forEach((cloud, index) => {
      const c = clouds[index]
      cloud.position.x =
        c.x + Math.sin(clock.elapsedTime * c.speed + index) * 1.5
    })
  })

  return (
    <group ref={group}>
      {clouds.map((cloud, index) => (
        <group
          key={index}
          position={[cloud.x, cloud.y, cloud.z]}
          scale={[cloud.scale, cloud.scale * 0.6, cloud.scale]}
        >
          {cloud.puffs.map(([x, y, z, r], i) => (
            <mesh key={i} position={[x, y, z]}>
              <icosahedronGeometry args={[r, 3]} />
              <meshStandardMaterial
                color="#ffffff"
                emissive="#e4efff"
                emissiveIntensity={0.55}
                roughness={1}
              />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  )
}

/** A few butterflies wandering over the grass */
function Butterflies() {
  const group = useRef<Group>(null)
  const butterflies = useMemo(
    () => [
      { color: '#ff8fab', center: [-2, 0, 1], radius: 2.2, speed: 0.35 },
      { color: '#ffd166', center: [4, 0, 2], radius: 1.8, speed: 0.45 },
      { color: '#9bf6ff', center: [-5, 0, -1], radius: 1.5, speed: 0.4 },
    ],
    []
  )

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    group.current?.children.forEach((butterfly, index) => {
      const b = butterflies[index]
      const a = t * b.speed + index * 2
      butterfly.position.set(
        b.center[0] + Math.cos(a) * b.radius + Math.sin(a * 2.3) * 0.4,
        0.8 + Math.sin(a * 3.1) * 0.25,
        b.center[2] + Math.sin(a) * b.radius * 0.7
      )
      butterfly.rotation.y = -a + Math.PI
      const flap = Math.sin(t * 18 + index) * 0.9
      butterfly.children[0].rotation.z = flap
      butterfly.children[1].rotation.z = -flap
    })
  })

  return (
    <group ref={group}>
      {butterflies.map((b, index) => (
        <group key={index}>
          {[-1, 1].map((side) => (
            <group key={side}>
              <mesh position={[side * 0.06, 0, 0]} rotation-x={-Math.PI / 2}>
                <circleGeometry args={[0.06, 10]} />
                <meshStandardMaterial color={b.color} side={2} />
              </mesh>
            </group>
          ))}
        </group>
      ))}
    </group>
  )
}

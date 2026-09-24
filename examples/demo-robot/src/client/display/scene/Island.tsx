import { RoundedBox } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import {
  BufferGeometry,
  Color,
  ConeGeometry,
  DataTexture,
  Float32BufferAttribute,
  InstancedMesh,
  LinearFilter,
  Object3D,
  RedFormat,
  ShaderMaterial,
  Vector3,
} from 'three'
import { HEIGHT, WIDTH } from '../../game/world'
import { random, tile, toWorld } from './grid'
import { PALETTE } from './palette'

const TURF = 0.1
const POND_BED = -0.42
const WATER_LEVEL = -0.2

/** Every tile of the island, the rim of grass around the garden included */
function tiles() {
  const list: Array<{ x: number; y: number; kind: string }> = []
  for (let y = -1; y <= HEIGHT; y++) {
    for (let x = -1; x <= WIDTH; x++) {
      list.push({ x, y, kind: tile(x, y) ?? 'rim' })
    }
  }
  return list
}

/** The floating island: grass, a sandy path, a pond and the soil below */
export default function Island() {
  return (
    <group>
      <Ground />
      <Pebbles />
      <Pond />
      <RoundedBox
        args={[WIDTH + 2, 0.7, HEIGHT + 2]}
        radius={0.12}
        position={[0, -0.8, 0]}
        receiveShadow
      >
        <meshStandardMaterial color={PALETTE.dirt} roughness={1} />
      </RoundedBox>
      <RoundedBox
        args={[WIDTH + 1.2, 0.6, HEIGHT + 1.2]}
        radius={0.2}
        position={[0, -1.4, 0]}
      >
        <meshStandardMaterial color={PALETTE.dirtDark} roughness={1} />
      </RoundedBox>
      <HangingRocks />
    </group>
  )
}

/**
 * The ground as one continuous surface, so no seam shows between tiles: the
 * grass and the path on top, soil walls where the island ends and around the
 * pond, and the bed of the pond.
 */
function Ground() {
  const geometry = useMemo(() => {
    const positions: number[] = []
    const normals: number[] = []
    const colors: number[] = []
    const color = new Color()

    const quad = (corners: number[][], normal: number[], tint: Color[]) => {
      // Wind the two triangles so they face the normal
      const [a, b, c] = corners.map((p) => new Vector3(...p))
      const facing = b
        .clone()
        .sub(a)
        .cross(c.clone().sub(a))
        .dot(new Vector3(...normal))
      const order = facing > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]
      for (const i of order) {
        positions.push(...corners[i])
        normals.push(...normal)
        colors.push(tint[i].r, tint[i].g, tint[i].b)
      }
    }
    const grass = (x: number, z: number) => {
      // Broad patches of lighter and darker grass, blended across the tiles
      const patch =
        Math.sin(x * 0.55 + 1.3) * Math.cos(z * 0.7 - 0.4) * 0.5 +
        Math.sin((x + z) * 0.3) * 0.5
      return new Color(PALETTE.grass).offsetHSL(patch * 0.02, 0, patch * 0.045)
    }
    const isOutside = (x: number, y: number) =>
      x < -1 || x > WIDTH || y < -1 || y > HEIGHT

    for (const t of tiles()) {
      const [cx, , cz] = toWorld(t.x, t.y)
      const corners = [
        [cx - 0.5, cz - 0.5],
        [cx - 0.5, cz + 0.5],
        [cx + 0.5, cz + 0.5],
        [cx + 0.5, cz - 0.5],
      ]

      if (t.kind === '~') {
        color.set(PALETTE.pondBed)
        quad(
          corners.map(([x, z]) => [x, POND_BED, z]),
          [0, 1, 0],
          corners.map(() => color)
        )
        continue
      }

      const isPath = t.kind === '='
      quad(
        corners.map(([x, z]) => [x, 0, z]),
        [0, 1, 0],
        corners.map(([x, z]) =>
          isPath ? new Color(PALETTE.path) : grass(x, z)
        )
      )

      // A wall of turf and soil wherever the ground drops
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = t.x + dx
        const ny = t.y + dy
        const bottom = isOutside(nx, ny)
          ? -0.5
          : tile(nx, ny) === '~'
            ? POND_BED
            : undefined
        if (bottom === undefined) continue
        const ex = cx + dx * 0.5
        const ez = cz + dy * 0.5
        const edge = [
          [ex - dy * 0.5, ez - dx * 0.5],
          [ex + dy * 0.5, ez + dx * 0.5],
        ]
        const turf = (
          isPath ? new Color(PALETTE.path) : grass(cx, cz)
        ).offsetHSL(0, 0, -0.08)
        const soil = new Color(PALETTE.dirt)
        for (const [top, low, tint] of [
          [0, -TURF, turf],
          [-TURF, bottom, soil],
        ] as const) {
          quad(
            [
              [edge[0][0], top, edge[0][1]],
              [edge[1][0], top, edge[1][1]],
              [edge[1][0], low, edge[1][1]],
              [edge[0][0], low, edge[0][1]],
            ],
            [dx, 0, dy],
            [tint, tint, tint, tint]
          )
        }
      }
    }

    const result = new BufferGeometry()
    result.setAttribute('position', new Float32BufferAttribute(positions, 3))
    result.setAttribute('normal', new Float32BufferAttribute(normals, 3))
    result.setAttribute('color', new Float32BufferAttribute(colors, 3))
    return result
  }, [])

  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial vertexColors roughness={0.95} />
    </mesh>
  )
}

/** Flat stones scattered along the path */
function Pebbles() {
  const ref = useRef<InstancedMesh>(null)
  const pebbles = useMemo(() => {
    const rand = random(11)
    return tiles()
      .filter((t) => t.kind === '=')
      .flatMap((t) =>
        Array.from({ length: 2 }, () => {
          const [x, , z] = toWorld(t.x, t.y)
          return {
            x: x + (rand() - 0.5) * 0.75,
            z: z + (rand() - 0.5) * 0.75,
            size: 0.05 + rand() * 0.06,
            angle: rand() * Math.PI,
          }
        })
      )
  }, [])

  useLayoutEffect(() => {
    const dummy = new Object3D()
    pebbles.forEach((p, index) => {
      dummy.position.set(p.x, 0, p.z)
      dummy.rotation.set(0, p.angle, 0)
      dummy.scale.set(p.size * 1.4, p.size * 0.5, p.size)
      dummy.updateMatrix()
      ref.current!.setMatrixAt(index, dummy.matrix)
    })
    ref.current!.instanceMatrix.needsUpdate = true
  }, [pebbles])

  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, pebbles.length]}
      receiveShadow
    >
      <dodecahedronGeometry args={[1, 0]} />
      <meshStandardMaterial color={PALETTE.pebble} flatShading />
    </instancedMesh>
  )
}

const WATER_VERTEX = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

const WATER_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform sampler2D uMask;
  uniform vec2 uSize;
  varying vec3 vWorld;

  void main() {
    vec2 p = vWorld.xz;
    // How deep inside the pond, 0.5 on the shore
    vec2 uv = (p + uSize * 0.5) / uSize;
    float inside = texture2D(uMask, uv).r;

    float wave = sin(p.x * 3.1 + uTime * 1.2) * sin(p.y * 2.7 - uTime * 0.9)
      + 0.6 * sin((p.x - p.y) * 4.3 + uTime * 1.6);
    float ripple = sin(p.x * 9.0 + sin(p.y * 7.0 + uTime) * 1.5 + uTime * 2.0)
      * sin(p.y * 8.0 - uTime * 1.7);
    float glints = smoothstep(0.82, 0.98, ripple) * 0.5 + smoothstep(1.2, 1.5, wave) * 0.2;
    float foam = 1.0 - smoothstep(0.52, 0.58, inside + wave * 0.015);

    vec3 deep = vec3(0.02, 0.2, 0.36);
    vec3 shallow = vec3(0.12, 0.55, 0.62);
    vec3 color = mix(shallow, deep, smoothstep(0.6, 1.0, inside));
    color += glints * 0.35;
    color = mix(color, vec3(0.75, 0.95, 1.0), foam * 0.45);

    gl_FragColor = vec4(color, mix(0.82, 0.95, foam));
    #include <colorspace_fragment>
  }
`

/** The water, lighter near the shore, with foam where it meets the grass */
function Pond() {
  const material = useRef<ShaderMaterial>(null)
  const { mask, center, size } = useMemo(() => {
    const w = WIDTH + 2
    const h = HEIGHT + 2
    const data = new Uint8Array(w * h)
    let minX = WIDTH
    let maxX = 0
    let minY = HEIGHT
    let maxY = 0
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        if (tile(x, y) !== '~') continue
        data[(y + 1) * w + x + 1] = 255
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
      }
    }
    const texture = new DataTexture(data, w, h, RedFormat)
    texture.magFilter = LinearFilter
    texture.minFilter = LinearFilter
    texture.needsUpdate = true
    const [x1, , z1] = toWorld(minX, minY)
    const [x2, , z2] = toWorld(maxX, maxY)
    return {
      mask: texture,
      center: [(x1 + x2) / 2, WATER_LEVEL, (z1 + z2) / 2] as const,
      size: [x2 - x1 + 1.2, z2 - z1 + 1.2] as const,
    }
  }, [])

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uMask: { value: mask },
      uSize: { value: [WIDTH + 2, HEIGHT + 2] },
    }),
    [mask]
  )

  useFrame((_, delta) => {
    if (material.current) material.current.uniforms.uTime.value += delta
  })

  return (
    <mesh position={[...center]} rotation-x={-Math.PI / 2}>
      <planeGeometry args={[...size]} />
      <shaderMaterial
        ref={material}
        vertexShader={WATER_VERTEX}
        fragmentShader={WATER_FRAGMENT}
        uniforms={uniforms}
        transparent
        depthWrite={false}
      />
    </mesh>
  )
}

/** The rocky underside of the island, so it floats */
function HangingRocks() {
  const rocks = useMemo(() => {
    const rand = random(23)
    return Array.from({ length: 22 }, (_, index) => {
      const angle = (index / 22) * Math.PI * 2
      const ring = 0.45 + rand() * 0.5
      return {
        x: Math.cos(angle) * ring * (WIDTH / 2 - 0.5),
        z: Math.sin(angle) * ring * (HEIGHT / 2 - 0.5),
        radius: 0.6 + rand() * 1.2,
        length: 2 + rand() * 4 * (1.2 - ring),
        angle: rand() * Math.PI,
        shade: rand(),
      }
    })
  }, [])
  const core = useMemo(() => rockyCone(7, 3), [])

  return (
    <group position={[0, -1.65, 0]}>
      <mesh geometry={core} scale={[WIDTH / 2 + 0.3, 11, HEIGHT / 2 + 0.3]}>
        <meshStandardMaterial color="#6b4b36" flatShading roughness={1} />
      </mesh>
      {rocks.map((rock, index) => (
        <mesh
          key={index}
          geometry={core}
          position={[rock.x, 0, rock.z]}
          rotation-y={rock.angle}
          scale={[rock.radius, rock.length, rock.radius]}
        >
          <meshStandardMaterial
            color={rock.shade > 0.5 ? '#7a5840' : '#5b4a3f'}
            flatShading
            roughness={1}
          />
        </mesh>
      ))}
    </group>
  )
}

/** An upside down cone of unit radius and height, its surface roughened */
function rockyCone(seed: number, rings: number) {
  const geometry = new ConeGeometry(1, 1, 9, rings)
  geometry.rotateX(Math.PI)
  geometry.translate(0, -0.5, 0)
  const position = geometry.getAttribute('position')
  const rand = random(seed)
  const jitter = new Map<string, number>()
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const y = position.getY(i)
    const z = position.getZ(i)
    // Vertices on the seam share their jitter, so the surface stays closed
    const key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`
    if (!jitter.has(key)) jitter.set(key, 0.82 + rand() * 0.36)
    const k = jitter.get(key)!
    position.setXYZ(i, x * k, y, z * k)
  }
  geometry.computeVertexNormals()
  return geometry
}

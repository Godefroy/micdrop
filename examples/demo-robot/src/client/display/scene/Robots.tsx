import { RoundedBox } from '@react-three/drei'
import { RefObject, useMemo } from 'react'
import {
  CanvasTexture,
  DoubleSide,
  MeshStandardMaterial,
  ShapeGeometry,
} from 'three'
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js'
import type { Mood } from '../../game/Game'
import { MOOD_LIGHT, PALETTE } from './palette'

/**
 * The bodies of the robots: Bip, and in the race, Jev after the TypeSafe logo
 * and Claude after Clawd, the mascot of Claude Code.
 */

export const JEV_MAGENTA = '#e551ba'
export const JEV_DARK = '#1e1e1e'
export const JEV_TEAL = '#09afa2'
export const CLAUDE_ORANGE = '#d77757'
export const CLAUDE_DARK = '#141413'
const CLAUDE_BLUE = '#6a9bcc'

export interface BodyProps {
  face: CanvasTexture
  antenna: RefObject<MeshStandardMaterial>
  asleep: boolean
}

/** A glowing ring under the body, the thruster Bip and Jev hover on */
function Thruster({ asleep, glow }: { asleep: boolean; glow: string }) {
  return (
    <>
      <mesh position={[0, 0.16, 0]}>
        <cylinderGeometry args={[0.14, 0.08, 0.1, 20]} />
        <meshStandardMaterial
          color={PALETTE.robotDark}
          metalness={0.6}
          roughness={0.3}
        />
      </mesh>
      <mesh position={[0, 0.1, 0]} rotation-x={Math.PI / 2}>
        <torusGeometry args={[0.08, 0.02, 8, 24]} />
        <meshStandardMaterial
          color="#ffffff"
          emissive={glow}
          emissiveIntensity={asleep ? 0.3 : 3}
          toneMapped={false}
        />
      </mesh>
    </>
  )
}

/** The screen on the head, where the face is drawn */
function Screen({ face, z }: { face: CanvasTexture; z: number }) {
  return (
    <mesh position={[0, 0, z]}>
      <planeGeometry args={[0.44, 0.275]} />
      <meshBasicMaterial
        map={face}
        color={[1.7, 1.7, 1.7]}
        toneMapped={false}
        transparent
      />
    </mesh>
  )
}

/** Bip: a white capsule, a screen for a head, an antenna with a light */
export function BipBody({
  face,
  antenna,
  asleep,
  mood,
}: BodyProps & { mood: Mood }) {
  return (
    <>
      <Thruster asleep={asleep} glow="#56e1ff" />
      <mesh position={[0, 0.42, 0]} castShadow>
        <capsuleGeometry args={[0.23, 0.12, 8, 20]} />
        <meshStandardMaterial
          color={PALETTE.robot}
          roughness={0.35}
          metalness={0.1}
        />
      </mesh>
      <mesh position={[0, 0.43, 0.215]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.1, 0.1, 0.03, 24]} />
        <meshStandardMaterial color={PALETTE.robotAccent} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.43, 0.235]}>
        <sphereGeometry args={[0.035, 12, 10]} />
        <meshStandardMaterial
          color="#ffffff"
          emissive={MOOD_LIGHT[mood]}
          emissiveIntensity={asleep ? 0.3 : 2.5}
          toneMapped={false}
        />
      </mesh>

      <mesh position={[0, 0.66, 0]}>
        <cylinderGeometry args={[0.07, 0.09, 0.08, 16]} />
        <meshStandardMaterial color={PALETTE.robotDark} metalness={0.5} />
      </mesh>
      <group position={[0, 0.88, 0]}>
        <RoundedBox
          args={[0.6, 0.44, 0.46]}
          radius={0.12}
          smoothness={4}
          castShadow
        >
          <meshStandardMaterial
            color={PALETTE.robot}
            roughness={0.3}
            metalness={0.1}
          />
        </RoundedBox>
        <RoundedBox
          args={[0.5, 0.33, 0.04]}
          radius={0.06}
          position={[0, 0, 0.215]}
        >
          <meshStandardMaterial
            color={PALETTE.robotDark}
            roughness={0.15}
            metalness={0.4}
          />
        </RoundedBox>
        <Screen face={face} z={0.237} />
        {[-1, 1].map((side) => (
          <mesh
            key={side}
            position={[side * 0.31, 0, 0]}
            rotation-z={Math.PI / 2}
          >
            <cylinderGeometry args={[0.1, 0.1, 0.06, 20]} />
            <meshStandardMaterial color={PALETTE.robotAccent} roughness={0.4} />
          </mesh>
        ))}
        <mesh position={[0, 0.3, 0]}>
          <cylinderGeometry args={[0.012, 0.012, 0.16, 6]} />
          <meshStandardMaterial color={PALETTE.robotDark} />
        </mesh>
        <mesh position={[0, 0.4, 0]}>
          <sphereGeometry args={[0.05, 16, 12]} />
          <meshStandardMaterial
            ref={antenna}
            color="#ffffff"
            toneMapped={false}
          />
        </mesh>
      </group>
    </>
  )
}

/** One cube of the TypeSafe logo: magenta faces, drawn by thick dark edges */
function Frame({
  size: [w, h, d],
  position,
}: {
  size: [number, number, number]
  position: [number, number, number]
}) {
  const bar = 0.045
  const bars: Array<{
    at: [number, number, number]
    size: [number, number, number]
  }> = []
  for (const a of [-1, 1]) {
    for (const b of [-1, 1]) {
      bars.push({
        at: [0, (a * h) / 2, (b * d) / 2],
        size: [w + bar, bar, bar],
      })
      bars.push({
        at: [(a * w) / 2, 0, (b * d) / 2],
        size: [bar, h + bar, bar],
      })
      bars.push({
        at: [(a * w) / 2, (b * h) / 2, 0],
        size: [bar, bar, d + bar],
      })
    }
  }
  return (
    <group position={position}>
      <mesh castShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={JEV_MAGENTA} roughness={0.55} />
      </mesh>
      {bars.map(({ at, size }, index) => (
        <mesh key={index} position={at}>
          <boxGeometry args={size} />
          <meshStandardMaterial color={JEV_DARK} roughness={0.4} />
        </mesh>
      ))}
    </group>
  )
}

/** The TypeSafe logo, from the path of its SVG, one unit high */
const TYPESAFE_LOGO =
  'M12.756 2.928 L12.756 7.067 L16.486 9.487 L16.487 18.652 L8.244 24 L3.732 21.073 L3.732 16.82 L0 14.399 L0 5.35 L0.355 5.118 L8.244 0 Z M5.94 20.65 L8.242 22.144 L14.275 18.227 L11.975 16.735 Z M9.022 10.332 L9.022 14.4 L5.29 16.822 L5.29 19.216 L11.197 15.383 L11.197 8.921 Z M12.756 15.384 L14.928 16.794 L14.928 10.332 L12.756 8.922 Z M2.21 13.976 L4.511 15.47 L6.812 13.976 L4.512 12.485 Z M1.559 6.193 L1.559 12.544 L3.731 11.134 L3.731 7.066 L7.464 4.643 L7.464 2.36 L1.56 6.193 Z M5.291 11.132 L7.463 12.542 L7.463 10.332 L5.292 8.921 L5.292 11.132 Z M5.94 7.487 L8.244 8.981 L10.544 7.488 L8.244 5.994 Z M9.024 4.643 L11.196 6.054 L11.196 3.774 L9.024 2.359 Z'

function useLogo() {
  return useMemo(() => {
    const svg = new SVGLoader().parse(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16.487 24"><path fill-rule="evenodd" d="${TYPESAFE_LOGO}"/></svg>`
    )
    const geometry = new ShapeGeometry(
      svg.paths.flatMap(SVGLoader.createShapes)
    )
    geometry.center()
    // The SVG counts y downwards
    geometry.scale(1 / 24, -1 / 24, 1)
    return geometry
  }, [])
}

/**
 * Jev, after the TypeSafe logo: the isometric S of two cubes, stacked off
 * center and joined by a small one, magenta with thick dark edges. The logo
 * is on its chest, and a dark screen shows its face
 */
export function JevBody({ face, antenna, asleep }: BodyProps) {
  const logo = useLogo()
  return (
    <>
      <Thruster asleep={asleep} glow={JEV_MAGENTA} />
      <Frame size={[0.42, 0.3, 0.38]} position={[0.07, 0.36, 0]} />
      <mesh geometry={logo} position={[0.07, 0.36, 0.192]} scale={0.22}>
        <meshStandardMaterial color={JEV_DARK} side={DoubleSide} />
      </mesh>
      <Frame size={[0.16, 0.12, 0.16]} position={[0, 0.575, 0]} />
      <group position={[-0.07, 0.84, 0]}>
        <Frame size={[0.56, 0.4, 0.42]} position={[0, 0, 0]} />
        <mesh position={[0, 0, 0.212]}>
          <planeGeometry args={[0.46, 0.3]} />
          <meshStandardMaterial color="#0d0a0f" roughness={0.2} />
        </mesh>
        <Screen face={face} z={0.215} />
        <mesh position={[0, 0.29, 0]}>
          <boxGeometry args={[0.03, 0.16, 0.03]} />
          <meshStandardMaterial color={JEV_DARK} />
        </mesh>
        {/* A cube seen corner on, the hexagon of the logo */}
        <mesh
          position={[0, 0.42, 0]}
          rotation={[Math.atan(1 / Math.SQRT2), Math.PI / 4, 0]}
        >
          <boxGeometry args={[0.09, 0.09, 0.09]} />
          <meshStandardMaterial
            ref={antenna}
            color={JEV_MAGENTA}
            toneMapped={false}
          />
        </mesh>
      </group>
    </>
  )
}

/**
 * Clawd, block for block: in its pixel grid, a body 13 pixels wide and 4
 * rows high, a row being twice as high as a pixel is wide, two slits for
 * eyes, arms sticking out of the third row, and four legs
 */
const U = 0.06
/** Its legs, a little longer than in the grid so the camera sees them */
const LEG = 3 * U
export const CLAWD = {
  /** Where its arms sit, from the middle of the body */
  shoulder: 6.5 * U,
  arm: LEG + 3 * U,
  /** The size of an arm */
  armSize: [2 * U, 2 * U, 3 * U] as [number, number, number],
  unit: U,
}

export function ClawdBody({ face }: { face: CanvasTexture }) {
  return (
    <>
      {/* Flush with its front, where the camera looking down can see them */}
      {[-6, -4, 4, 6].map((x) => (
        <mesh key={x} position={[x * U, LEG / 2, 2 * U]} castShadow>
          <boxGeometry args={[U, LEG, 2 * U]} />
          <meshStandardMaterial color={CLAUDE_ORANGE} roughness={0.85} />
        </mesh>
      ))}
      <mesh position={[0, LEG + 4 * U, 0]} castShadow>
        <boxGeometry args={[13 * U, 8 * U, 6 * U]} />
        <meshStandardMaterial color={CLAUDE_ORANGE} roughness={0.85} />
      </mesh>
      <mesh position={[0, LEG + 4 * U, 3 * U + 0.002]}>
        <planeGeometry args={[13 * U, 8 * U]} />
        <meshBasicMaterial map={face} transparent toneMapped={false} />
      </mesh>
    </>
  )
}

/**
 * Clawd's face in pixels, on its whole front: 13 by 8 units, drawn in half
 * units. Its eyes are two dark slits, and its moods move them around, with a
 * tear when it is sad
 */
export const CLAWD_FACE = { width: 208, height: 128 }

export function drawClawdFace(
  canvas: HTMLCanvasElement,
  mood: Mood,
  blink: boolean,
  glance: number
) {
  const ctx = canvas.getContext('2d')!
  const half = 8
  const px = (x: number, y: number, w = 1, h = 1) =>
    ctx.fillRect(x * half, y * half, w * half, h * half)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = CLAUDE_DARK

  // The left eye, then the right one, in half units
  const eyes = [4, 20]
  const shift = mood === 'neutral' ? Math.sign(glance) : 0

  eyes.forEach((x, index) => {
    const outer = index === 0 ? -1 : 1
    if (mood === 'sleepy') {
      px(x - 1, 7, 4, 1)
    } else if (blink) {
      px(x, 6, 2, 1)
    } else if (mood === 'happy') {
      px(x - 1, 6)
      px(x, 5, 2, 1)
      px(x + 2, 6)
    } else if (mood === 'sad') {
      px(x, 5, 2, 3)
      // Brows raised on the inside
      px(outer < 0 ? x - 1 : x + 2, 3)
      px(outer < 0 ? x + 1 : x - 1, 2, 2, 1)
    } else if (mood === 'confused') {
      if (index === 0) px(x, 4, 2, 4)
      else px(x, 6, 2, 2)
    } else {
      px(x + shift, 4, 2, 4)
    }
  })

  if (mood === 'sad' && !blink) {
    ctx.fillStyle = CLAUDE_BLUE
    px(eyes[0], 9, 1, 2)
  }
}

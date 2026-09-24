import { Html, RoundedBox } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  CanvasTexture,
  Color,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
} from 'three'
import type { Mood, Robot } from '../../game/Game'
import type { Entity } from '../../game/world'
import { dampAngle, FACING, toWorld } from './grid'
import Model from './models/Model'
import { MOOD_LIGHT, PALETTE } from './palette'

interface BipProps {
  robot: Robot
  held?: Entity
  /** No call yet: Bip dozes */
  asleep: boolean
  /** The user is speaking: Bip's antenna and the ring under it light up */
  listening: boolean
}

/**
 * Bip hovers from tile to tile. Its face shows its mood, its arms carry what
 * it holds, and its tricks are played from the moment they start.
 */
export default function Bip({ robot, held, asleep, listening }: BipProps) {
  const root = useRef<Group>(null)
  const body = useRef<Group>(null)
  const leftArm = useRef<Group>(null)
  const rightArm = useRef<Group>(null)
  const axe = useRef<Group>(null)
  const antenna = useRef<MeshStandardMaterial>(null)
  const ring = useRef<Mesh>(null)
  const trickStart = useRef(0)
  const startTrick = useRef(true)
  const mood: Mood = asleep ? 'sleepy' : robot.mood
  const face = useFace(mood)
  const light = useMemo(() => new Color(), [])

  useLayoutEffect(() => {
    root.current!.position.set(...toWorld(robot.x, robot.y))
    root.current!.rotation.y = FACING[robot.facing]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    startTrick.current = true
  }, [robot.trick])

  useFrame(({ clock }, delta) => {
    const now = clock.elapsedTime
    if (startTrick.current) {
      trickStart.current = now
      startTrick.current = false
    }
    const t = now - trickStart.current
    const trick = robot.trick

    // Glide to the tile, turn to face the way
    const [x, , z] = toWorld(robot.x, robot.y)
    const g = root.current!
    g.position.x = MathUtils.damp(g.position.x, x, 12, delta)
    g.position.z = MathUtils.damp(g.position.z, z, 12, delta)
    g.rotation.y = dampAngle(g.rotation.y, FACING[robot.facing], 10, delta)
    const speed = Math.hypot(x - g.position.x, z - g.position.z)

    // Hover, and play the trick on the body
    const b = body.current!
    const hover = asleep ? 0.02 : 0.06 + Math.sin(now * 2.4) * 0.03
    b.position.y =
      hover +
      (trick === 'jump' || trick === 'wave'
        ? Math.abs(Math.sin(t * 7)) * 0.45
        : 0)
    b.rotation.z = trick === 'dance' ? Math.sin(t * 12) * 0.25 : 0
    b.rotation.y = trick === 'spin' ? Math.min(t / 0.8, 1) * Math.PI * 2 : 0
    b.rotation.x = MathUtils.damp(
      b.rotation.x,
      asleep ? 0.18 : trick === 'chop' ? 0.2 : Math.min(speed * 0.6, 0.25),
      6,
      delta
    )

    // Arms: carry, wave, chop, dance
    const la = leftArm.current!
    const ra = rightArm.current!
    let left = { x: 0, z: 0.15 }
    let right = { x: 0, z: -0.15 }
    if (held) {
      left = { x: -1.25, z: 0.1 }
      right = { x: -1.25, z: -0.1 }
    }
    if (trick === 'wave') right = { x: 0, z: -2.6 + Math.sin(t * 14) * 0.4 }
    if (trick === 'dance') {
      left = { x: 0, z: 2.4 + Math.sin(t * 12) * 0.4 }
      right = { x: 0, z: -2.4 + Math.sin(t * 12) * 0.4 }
    }
    if (trick === 'chop')
      right = { x: -2.2 + Math.abs(Math.sin(t * 9)) * 1.8, z: -0.1 }
    la.rotation.x = MathUtils.damp(la.rotation.x, left.x, 14, delta)
    la.rotation.z = MathUtils.damp(la.rotation.z, left.z, 14, delta)
    ra.rotation.x = MathUtils.damp(ra.rotation.x, right.x, 14, delta)
    ra.rotation.z = MathUtils.damp(ra.rotation.z, right.z, 14, delta)
    axe.current!.visible = trick === 'chop'

    // The antenna glows with the mood, brighter while the user speaks
    light.set(MOOD_LIGHT[mood])
    const pulse = listening
      ? 4 + Math.sin(now * 14) * 2
      : 1.6 + Math.sin(now * 3) * 0.6
    antenna.current!.emissive.copy(light)
    antenna.current!.emissiveIntensity = asleep ? 0.4 : pulse

    const r = ring.current!
    const ringScale = listening ? 1 + ((now * 1.4) % 1) * 0.8 : 1
    r.scale.setScalar(ringScale)
    const ringMaterial = r.material as MeshStandardMaterial
    ringMaterial.emissive.copy(light)
    ringMaterial.opacity = listening ? 1 - ((now * 1.4) % 1) : asleep ? 0 : 0.35
  })

  return (
    <group ref={root} scale={1.35}>
      {/* A glowing ring on the ground, pulsing while the user speaks */}
      <mesh ref={ring} position={[0, 0.02, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.34, 0.4, 40]} />
        <meshStandardMaterial
          color="#000000"
          emissiveIntensity={2}
          transparent
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      <group ref={body}>
        {/* Thruster */}
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
            color="#9ff3ff"
            emissive="#56e1ff"
            emissiveIntensity={asleep ? 0.3 : 3}
            toneMapped={false}
          />
        </mesh>

        {/* Body */}
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

        {/* Head */}
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
          <mesh position={[0, 0, 0.237]}>
            <planeGeometry args={[0.44, 0.275]} />
            <meshBasicMaterial
              map={face}
              color={[1.7, 1.7, 1.7]}
              toneMapped={false}
              transparent
            />
          </mesh>
          {[-1, 1].map((side) => (
            <mesh
              key={side}
              position={[side * 0.31, 0, 0]}
              rotation-z={Math.PI / 2}
            >
              <cylinderGeometry args={[0.1, 0.1, 0.06, 20]} />
              <meshStandardMaterial
                color={PALETTE.robotAccent}
                roughness={0.4}
              />
            </mesh>
          ))}
          {/* Antenna */}
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

        {/* Arms, pivoting at the shoulders */}
        {[-1, 1].map((side) => (
          <group
            key={side}
            ref={side < 0 ? rightArm : leftArm}
            position={[side * 0.28, 0.5, 0]}
          >
            <mesh position={[side * 0.02, -0.12, 0]} castShadow>
              <capsuleGeometry args={[0.05, 0.14, 4, 10]} />
              <meshStandardMaterial color={PALETTE.robot} roughness={0.35} />
            </mesh>
            <mesh position={[side * 0.02, -0.25, 0]}>
              <sphereGeometry args={[0.065, 14, 10]} />
              <meshStandardMaterial
                color={PALETTE.robotAccent}
                roughness={0.4}
              />
            </mesh>
            {side < 0 && (
              <group ref={axe} position={[-0.02, -0.28, 0]} visible={false}>
                <mesh position={[0, -0.1, 0]}>
                  <cylinderGeometry args={[0.015, 0.015, 0.3, 6]} />
                  <meshStandardMaterial color="#8a5a3b" />
                </mesh>
                <mesh position={[0, -0.22, 0.06]}>
                  <boxGeometry args={[0.02, 0.1, 0.12]} />
                  <meshStandardMaterial
                    color="#c9d1d9"
                    metalness={0.9}
                    roughness={0.2}
                  />
                </mesh>
              </group>
            )}
          </group>
        ))}

        {/* What Bip carries, held out in front */}
        {held && (
          <group position={[0, 0.3, 0.42]} scale={0.6}>
            <Model entity={held} />
          </group>
        )}
      </group>

      {robot.bubble && (
        <Html
          position={[0, 1.4, 0]}
          zIndexRange={[30, 20]}
          pointerEvents="none"
        >
          <div className="bubble-anchor">
            <div key={robot.bubble} className="bubble animate-pop-in">
              {robot.bubble}
            </div>
          </div>
        </Html>
      )}
      {asleep && (
        <Html
          position={[0.25, 1.3, 0]}
          zIndexRange={[30, 20]}
          pointerEvents="none"
        >
          <div className="snore">
            <span>z</span>
            <span>z</span>
            <span>Z</span>
          </div>
        </Html>
      )}
    </group>
  )
}

/** Bip's face, drawn on a canvas: eyes that blink and glance, a mouth */
function useFace(mood: Mood) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 160
    const t = new CanvasTexture(canvas)
    t.colorSpace = SRGBColorSpace
    return t
  }, [])
  const [blink, setBlink] = useState(false)
  const [glance, setGlance] = useState(0)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const loop = () => {
      setBlink(true)
      setTimeout(() => setBlink(false), 130)
      if (Math.random() < 0.4)
        setGlance(Math.round((Math.random() - 0.5) * 3) * 8)
      timer = setTimeout(loop, 2200 + Math.random() * 2600)
    }
    timer = setTimeout(loop, 1500)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    drawFace(texture.image as HTMLCanvasElement, mood, blink, glance)
    texture.needsUpdate = true
  }, [texture, mood, blink, glance])

  return texture
}

function drawFace(
  canvas: HTMLCanvasElement,
  mood: Mood,
  blink: boolean,
  glance: number
) {
  const ctx = canvas.getContext('2d')!
  const color = MOOD_LIGHT[mood]
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = color
  ctx.strokeStyle = color
  ctx.lineCap = 'round'
  ctx.lineWidth = 11
  ctx.shadowColor = color
  ctx.shadowBlur = 18

  const eyes = [84 + glance, 172 + glance]
  const eyeY = 66

  const pill = (x: number, y: number, w: number, h: number) => {
    ctx.beginPath()
    ctx.roundRect(x - w / 2, y - h / 2, w, h, w / 2)
    ctx.fill()
  }
  const arc = (x: number, y: number, r: number, from: number, to: number) => {
    ctx.beginPath()
    ctx.arc(x, y, r, from * Math.PI, to * Math.PI)
    ctx.stroke()
  }

  if (mood === 'sleepy') {
    eyes.forEach((x) => arc(x, eyeY - 8, 18, 0.15, 0.85))
    ctx.beginPath()
    ctx.arc(128, 118, 8, 0, Math.PI * 2)
    ctx.lineWidth = 6
    ctx.stroke()
    return
  }

  if (blink) {
    eyes.forEach((x) => pill(x, eyeY, 38, 8))
  } else if (mood === 'happy') {
    eyes.forEach((x) => arc(x, eyeY + 10, 20, 1.1, 1.9))
  } else if (mood === 'sad') {
    eyes.forEach((x) => pill(x, eyeY + 6, 30, 34))
    ctx.lineWidth = 7
    ctx.beginPath()
    ctx.moveTo(eyes[0] - 22, eyeY - 22)
    ctx.lineTo(eyes[0] + 14, eyeY - 32)
    ctx.moveTo(eyes[1] + 22, eyeY - 22)
    ctx.lineTo(eyes[1] - 14, eyeY - 32)
    ctx.stroke()
  } else if (mood === 'confused') {
    pill(eyes[0], eyeY, 32, 50)
    pill(eyes[1], eyeY + 6, 26, 26)
  } else {
    eyes.forEach((x) => pill(x, eyeY, 32, 50))
  }

  ctx.lineWidth = 9
  if (mood === 'happy') {
    arc(128, 100, 30, 0.12, 0.88)
  } else if (mood === 'sad') {
    arc(128, 142, 22, 1.2, 1.8)
  } else if (mood === 'confused') {
    ctx.beginPath()
    ctx.moveTo(100, 126)
    ctx.quadraticCurveTo(114, 114, 128, 124)
    ctx.quadraticCurveTo(142, 134, 156, 120)
    ctx.stroke()
  } else {
    arc(128, 104, 18, 0.2, 0.8)
  }
}

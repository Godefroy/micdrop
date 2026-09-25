import { PerformanceMonitor, SoftShadows } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import {
  Bloom,
  EffectComposer,
  HueSaturation,
  N8AO,
  SMAA,
  TiltShift2,
  ToneMapping,
  Vignette,
} from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Color, InstancedMesh, Object3D } from 'three'
import type { GameState } from '../../game/Game'
import type { Look } from '../../mode'
import { HEIGHT, WIDTH } from '../../game/world'
import Bip from './Bip'
import Camera from './Camera'
import Decor from './Decor'
import { random } from './grid'
import House from './House'
import Island from './Island'
import Things from './Things'

interface SceneProps {
  state: GameState
  look: Look
  /**
   * Two scenes side by side keep a steady quality: no soft shadows, which
   * patch the shaders of three.js for the whole page, and no drop in quality
   * on a slow machine, which resizes the canvas and flashes it
   */
  steady?: boolean
  asleep: boolean
  listening: boolean
}

/** The garden in 3D, drawn from the state of the game and nothing else */
export default function Scene({
  state,
  look,
  steady = false,
  asleep,
  listening,
}: SceneProps) {
  const held = state.entities.find((e) => e.id === state.robot.holding)
  // A machine that cannot keep up drops to one pixel per point, without the
  // costliest effects
  const [low, setLow] = useState(false)

  return (
    <Canvas
      shadows
      dpr={low ? 1 : [1, 1.5]}
      camera={{ fov: 30, near: 0.5, far: 400 }}
      gl={{ antialias: false }}
    >
      {!steady && <PerformanceMonitor onDecline={() => setLow(true)} />}
      {!steady && <SoftShadows size={16} samples={low ? 6 : 12} focus={0.5} />}
      <Lights />
      <Camera
        focus={state.robot}
        quests={Object.values(state.quests).filter(Boolean).length}
        won={state.won}
      />

      <Island />
      <House />
      <Decor />
      <Things entities={state.entities} effects={state.effects} />
      <Bip
        robot={state.robot}
        look={look}
        held={held}
        asleep={asleep}
        listening={listening}
      />
      {state.won && <Confetti />}

      {/* No multisampling, SMAA smooths the edges for a fraction of its cost */}
      <EffectComposer multisampling={0}>
        <N8AO
          aoRadius={0.8}
          intensity={low ? 0 : 1.6}
          distanceFalloff={0.6}
          quality="performance"
          halfRes
        />
        <Bloom
          mipmapBlur
          luminanceThreshold={1}
          luminanceSmoothing={0.2}
          intensity={0.9}
        />
        <TiltShift2
          blur={low ? 0 : 0.12}
          taper={0.6}
          start={[0, 0.5]}
          end={[1, 0.5]}
        />
        <HueSaturation saturation={0.12} />
        <Vignette offset={0.35} darkness={0.45} />
        <ToneMapping mode={ToneMappingMode.NEUTRAL} />
        <SMAA />
      </EffectComposer>
    </Canvas>
  )
}

/** A warm late-afternoon sun, and a sky and ground bounce */
function Lights() {
  return (
    <>
      <hemisphereLight args={['#d6ebff', '#7a9a50', 1.5]} />
      <directionalLight
        position={[-9, 16, 9]}
        intensity={3.6}
        color="#ffe6c2"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-camera-left={-13}
        shadow-camera-right={13}
        shadow-camera-top={11}
        shadow-camera-bottom={-11}
        shadow-camera-near={1}
        shadow-camera-far={50}
      />
      <directionalLight
        position={[10, 6, -8]}
        intensity={0.6}
        color="#b8d4ff"
      />
    </>
  )
}

/** Once every quest is done, it rains confetti over the garden */
function Confetti() {
  const ref = useRef<InstancedMesh>(null)
  const pieces = useMemo(() => {
    const rand = random(97)
    return Array.from({ length: 220 }, () => ({
      x: (rand() - 0.5) * WIDTH,
      z: (rand() - 0.5) * HEIGHT,
      offset: rand() * 10,
      speed: 0.8 + rand() * 0.8,
      spin: rand() * 6,
      color: ['#ff6b8b', '#ffd166', '#8dffb0', '#7de8ff', '#c9b5ff'][
        Math.floor(rand() * 5)
      ],
    }))
  }, [])

  useLayoutEffect(() => {
    const color = new Color()
    pieces.forEach((p, index) =>
      ref.current!.setColorAt(index, color.set(p.color))
    )
    ref.current!.instanceColor!.needsUpdate = true
  }, [pieces])

  const dummy = useMemo(() => new Object3D(), [])
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    pieces.forEach((p, index) => {
      const fall = (t * p.speed + p.offset) % 10
      dummy.position.set(p.x + Math.sin(t + p.offset) * 0.3, 8 - fall, p.z)
      dummy.rotation.set(t * p.spin, t * p.spin * 0.7, 0)
      dummy.updateMatrix()
      ref.current!.setMatrixAt(index, dummy.matrix)
    })
    ref.current!.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, pieces.length]}>
      <planeGeometry args={[0.12, 0.07]} />
      <meshStandardMaterial side={2} emissiveIntensity={0.3} />
    </instancedMesh>
  )
}

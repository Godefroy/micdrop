import { CameraControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import CameraControlsImpl from 'camera-controls'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { PerspectiveCamera, Vector3 } from 'three'
import { HEIGHT, WIDTH } from '../../game/world'
import { toWorld } from './grid'

const ELEVATION = 0.9
/** How much closer than the whole island the camera starts */
const ZOOM = 2
/** How much the camera leans towards Bip as it moves around */
const FOLLOW = 0.8

interface CameraProps {
  /** The tile Bip stands on */
  focus: { x: number; y: number }
  /** Grows by one with every quest done */
  quests: number
  won: boolean
}

/**
 * Frames the island whatever the shape of the window, flying in on load,
 * twice closer than the whole of it. It then follows Bip, moves closer for a
 * moment when a quest is done, and circles the garden once they all are. The
 * user can turn, and zoom out up to the whole island.
 */
export default function Camera({ focus, quests, won }: CameraProps) {
  const controls = useRef<CameraControlsImpl>(null)
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const size = useThree((s) => s.size)
  const framing = useRef<{ target: Vector3; distance: number }>()
  const flewIn = useRef(false)
  const lastQuests = useRef(quests)

  const aim = (share: number) => {
    const { target } = framing.current!
    const [x, , z] = toWorld(focus.x, focus.y)
    return new Vector3(
      target.x + (x - target.x) * share,
      target.y,
      target.z + (z - target.z) * share
    )
  }

  useLayoutEffect(() => {
    const c = controls.current!
    c.mouseButtons.right = CameraControlsImpl.ACTION.NONE
    c.mouseButtons.middle = CameraControlsImpl.ACTION.NONE
    c.touches.two = CameraControlsImpl.ACTION.TOUCH_DOLLY
    c.touches.three = CameraControlsImpl.ACTION.NONE
    c.minPolarAngle = 0.3
    c.maxPolarAngle = 1.15
    c.minAzimuthAngle = -0.8
    c.maxAzimuthAngle = 0.8
  }, [])

  // Frame the island again whenever the canvas changes size
  useLayoutEffect(() => {
    const c = controls.current!
    camera.aspect = size.width / size.height
    camera.updateProjectionMatrix()
    framing.current = frame(camera)
    const { distance } = framing.current
    c.minDistance = distance * 0.3
    c.maxDistance = distance * 1.15
    const target = aim(FOLLOW)
    const position = target
      .clone()
      .addScaledVector(direction(0), distance / ZOOM)

    if (!flewIn.current) {
      // Start far away and turned, then glide into place
      flewIn.current = true
      const start = target
        .clone()
        .addScaledVector(direction(0.7, ELEVATION - 0.3), distance * 1.15)
      c.setLookAt(...start.toArray(), ...target.toArray(), false)
      c.smoothTime = 1.4
      c.setLookAt(...position.toArray(), ...target.toArray(), true).then(() => {
        c.smoothTime = 0.7
      })
    } else {
      c.setLookAt(...position.toArray(), ...target.toArray(), true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, size])

  // Lean towards Bip as it goes
  useEffect(() => {
    if (!framing.current) return
    controls.current!.moveTo(...aim(FOLLOW).toArray(), true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus.x, focus.y])

  // A quest done: come closer to Bip for a moment
  useEffect(() => {
    const done = quests > lastQuests.current
    lastQuests.current = quests
    if (!done || !framing.current) return
    const c = controls.current!
    const { distance } = framing.current
    c.moveTo(...aim(1).toArray(), true)
    c.dollyTo((distance / ZOOM) * 0.72, true)
    const timer = setTimeout(() => {
      c.moveTo(...aim(FOLLOW).toArray(), true)
      c.dollyTo(distance / ZOOM, true)
    }, 2400)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quests])

  // Every quest done: circle the garden slowly
  useEffect(() => {
    const c = controls.current!
    c.minAzimuthAngle = won ? -Infinity : -0.8
    c.maxAzimuthAngle = won ? Infinity : 0.8
  }, [won])
  useFrame((_, delta) => {
    if (won) controls.current!.rotate(delta * 0.12, 0, false)
  })

  return <CameraControls ref={controls} makeDefault dollyToCursor={false} />
}

/** From the target towards the camera, turned around the island */
function direction(azimuth: number, elevation = ELEVATION) {
  return new Vector3(
    Math.sin(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
    Math.cos(azimuth) * Math.cos(elevation)
  )
}

/** The corners of the island, the roof of the house included */
const CORNERS = [-1, 1].flatMap((sx) =>
  [-1, 1].flatMap((sz) =>
    [0.4, -1.7].map(
      (y) => new Vector3(sx * (WIDTH / 2 + 1), y, sz * (HEIGHT / 2 + 1))
    )
  )
)
CORNERS.push(new Vector3(-WIDTH / 2 + 1.5, 3.4, -HEIGHT / 2 + 1.5))

/**
 * Moves a copy of the camera back until every corner of the island is on
 * screen, then shifts its aim until the island sits in the middle.
 */
function frame(camera: PerspectiveCamera) {
  const probe = camera.clone()
  const toward = direction(0)
  const target = new Vector3(0, -0.4, 0)
  const margin = 0.9
  const place = (distance: number) => {
    probe.position.copy(target).addScaledVector(toward, distance)
    probe.lookAt(target)
    probe.updateMatrixWorld()
    const points = CORNERS.map((corner) => corner.clone().project(probe))
    return {
      fits: points.every(
        (p) => Math.abs(p.x) <= margin && Math.abs(p.y) <= margin
      ),
      middle:
        (Math.max(...points.map((p) => p.y)) +
          Math.min(...points.map((p) => p.y))) /
        2,
    }
  }

  let distance = 30
  for (let pass = 0; pass < 4; pass++) {
    let near = 5
    let far = 300
    for (let i = 0; i < 30; i++) {
      distance = (near + far) / 2
      if (place(distance).fits) far = distance
      else near = distance
    }
    distance = far
    const { middle } = place(distance)
    const height = Math.tan((probe.fov * Math.PI) / 360) * distance
    target.z -= (middle * height) / Math.sin(ELEVATION)
  }
  return { target, distance }
}

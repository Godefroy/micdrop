import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { CatmullRomCurve3, Group, TubeGeometry, Vector3 } from 'three'

interface PetProps {
  /** Reacting to something Bip did: it hops and wags */
  excited?: boolean
}

/** The ginger cat, its tail swaying slowly */
export function Cat({ excited }: PetProps) {
  const body = useRef<Group>(null)
  const tail = useRef<Group>(null)
  const tailGeometry = useMemo(
    () =>
      new TubeGeometry(
        new CatmullRomCurve3([
          new Vector3(0, 0, 0),
          new Vector3(0, 0.08, -0.1),
          new Vector3(0, 0.24, -0.12),
          new Vector3(0, 0.32, -0.05),
        ]),
        12,
        0.026,
        6
      ),
    []
  )

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    tail.current!.rotation.z = Math.sin(t * (excited ? 8 : 1.6)) * 0.45
    body.current!.position.y = excited ? Math.abs(Math.sin(t * 9)) * 0.12 : 0
    body.current!.scale.y = 1 + Math.sin(t * 2.2) * 0.015
  })

  const fur = <meshStandardMaterial color="#f4a261" roughness={0.9} />
  const cream = <meshStandardMaterial color="#fff1e0" roughness={0.9} />

  return (
    <group ref={body} scale={0.95}>
      <mesh position={[0, 0.24, 0]} rotation-x={Math.PI / 2} castShadow>
        <capsuleGeometry args={[0.13, 0.2, 6, 12]} />
        {fur}
      </mesh>
      <mesh position={[0, 0.2, 0.1]} scale={[0.1, 0.09, 0.08]}>
        <sphereGeometry args={[1, 12, 10]} />
        {cream}
      </mesh>
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => (
          <mesh
            key={`${sx}${sz}`}
            position={[sx * 0.07, 0.08, sz * 0.1]}
            castShadow
          >
            <cylinderGeometry args={[0.035, 0.03, 0.16, 8]} />
            {sz > 0 ? cream : fur}
          </mesh>
        ))
      )}
      <group position={[0, 0.41, 0.17]}>
        <mesh castShadow>
          <sphereGeometry args={[0.13, 16, 12]} />
          {fur}
        </mesh>
        <mesh position={[0, -0.04, 0.09]} scale={[0.07, 0.05, 0.05]}>
          <sphereGeometry args={[1, 10, 8]} />
          {cream}
        </mesh>
        {[-1, 1].map((side) => (
          <group key={side}>
            <mesh
              position={[side * 0.075, 0.12, -0.01]}
              rotation-z={side * -0.35}
              castShadow
            >
              <coneGeometry args={[0.05, 0.11, 4]} />
              {fur}
            </mesh>
            <Eye position={[side * 0.05, 0.02, 0.115]} />
          </group>
        ))}
        <mesh position={[0, -0.02, 0.135]}>
          <sphereGeometry args={[0.014, 8, 6]} />
          <meshStandardMaterial color="#ff8fa3" />
        </mesh>
      </group>
      <group ref={tail} position={[0, 0.28, -0.2]}>
        <mesh geometry={tailGeometry} castShadow>
          {fur}
        </mesh>
      </group>
    </group>
  )
}

/** The dog, with floppy ears and a tail that never stops */
export function Dog({ excited }: PetProps) {
  const body = useRef<Group>(null)
  const tail = useRef<Group>(null)
  const ears = useRef<Group>(null)

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    tail.current!.rotation.z = Math.sin(t * (excited ? 22 : 7)) * 0.5
    body.current!.position.y = excited ? Math.abs(Math.sin(t * 8)) * 0.14 : 0
    body.current!.scale.y = 1 + Math.sin(t * 3) * 0.02
    ears.current!.children.forEach((ear, index) => {
      ear.rotation.z =
        (index ? -1 : 1) * (0.2 + Math.sin(t * (excited ? 16 : 2)) * 0.12)
    })
  })

  const fur = <meshStandardMaterial color="#c68b59" roughness={0.9} />
  const white = <meshStandardMaterial color="#fbf3e8" roughness={0.9} />
  const dark = <meshStandardMaterial color="#7a4e2d" roughness={0.9} />

  return (
    <group ref={body}>
      <mesh position={[0, 0.28, 0]} rotation-x={Math.PI / 2} castShadow>
        <capsuleGeometry args={[0.15, 0.26, 6, 12]} />
        {fur}
      </mesh>
      <mesh position={[0, 0.24, 0.12]} scale={[0.11, 0.1, 0.09]}>
        <sphereGeometry args={[1, 12, 10]} />
        {white}
      </mesh>
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => (
          <mesh
            key={`${sx}${sz}`}
            position={[sx * 0.08, 0.1, sz * 0.13]}
            castShadow
          >
            <cylinderGeometry args={[0.042, 0.036, 0.2, 8]} />
            {sz > 0 ? white : fur}
          </mesh>
        ))
      )}
      <mesh position={[0, 0.4, 0.17]} rotation-x={Math.PI / 2}>
        <torusGeometry args={[0.09, 0.022, 8, 20]} />
        <meshStandardMaterial color="#e63946" />
      </mesh>
      <group position={[0, 0.5, 0.22]}>
        <mesh castShadow>
          <sphereGeometry args={[0.15, 16, 12]} />
          {fur}
        </mesh>
        <mesh position={[0, -0.04, 0.13]} scale={[0.08, 0.065, 0.1]}>
          <sphereGeometry args={[1, 12, 10]} />
          {white}
        </mesh>
        <mesh position={[0, -0.01, 0.23]}>
          <sphereGeometry args={[0.028, 10, 8]} />
          <meshStandardMaterial color="#1b1b1b" roughness={0.3} />
        </mesh>
        {[-1, 1].map((side) => (
          <Eye key={side} position={[side * 0.06, 0.04, 0.125]} />
        ))}
        <group ref={ears}>
          {[-1, 1].map((side) => (
            <group key={side} position={[side * 0.12, 0.07, -0.01]}>
              <mesh
                position={[side * 0.02, -0.08, 0]}
                scale={[0.04, 0.1, 0.07]}
              >
                <sphereGeometry args={[1, 10, 8]} />
                {dark}
              </mesh>
            </group>
          ))}
        </group>
      </group>
      <group ref={tail} position={[0, 0.36, -0.26]} rotation-x={-0.7}>
        <mesh position={[0, 0.08, 0]} castShadow>
          <capsuleGeometry args={[0.03, 0.12, 4, 8]} />
          {fur}
        </mesh>
      </group>
    </group>
  )
}

function Eye({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh>
        <sphereGeometry args={[0.022, 10, 8]} />
        <meshStandardMaterial color="#1b1b1b" roughness={0.2} />
      </mesh>
      <mesh position={[0.007, 0.008, 0.017]}>
        <sphereGeometry args={[0.006, 6, 6]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
    </group>
  )
}

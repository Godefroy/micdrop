import type { Entity, Kind } from '../../../game/world'
import {
  Apple,
  Ball,
  Banana,
  Bucket,
  Chest,
  Fish,
  Lamp,
  Star,
  Wood,
} from './Items'
import { Cat, Dog } from './Pets'
import { AppleTree, Flower, Pine } from './Plants'

/** Characters and small things are drawn larger than life, to read from afar */
const SCALE: Partial<Record<Kind, number>> = {
  cat: 1.45,
  dog: 1.4,
  flower: 1.35,
  bucket: 1.3,
  ball: 1.3,
  apple: 1.4,
  banana: 1.4,
  wood: 1.3,
  fish: 1.4,
  star: 1.3,
  chest: 1.3,
}

/** The 3D model of a thing in the garden, in the state the game gives it */
export default function Model({
  entity,
  excited,
}: {
  entity: Entity
  excited?: boolean
}) {
  return (
    <group scale={SCALE[entity.kind] ?? 1}>
      <Shape entity={entity} excited={excited} />
    </group>
  )
}

function Shape({ entity, excited }: { entity: Entity; excited?: boolean }) {
  switch (entity.kind) {
    case 'flower':
      return <Flower watered={entity.on} />
    case 'bucket':
      return <Bucket />
    case 'ball':
      return <Ball />
    case 'cat':
      return <Cat excited={excited} />
    case 'dog':
      return <Dog excited={excited} />
    case 'apple_tree':
      return <AppleTree />
    case 'apple':
      return <Apple />
    case 'banana':
      return <Banana />
    case 'tree':
      return <Pine seed={entity.id} />
    case 'wood':
      return <Wood />
    case 'fish':
      return <Fish />
    case 'lamp':
      return <Lamp on={entity.on} />
    case 'chest':
      return <Chest open={entity.on} />
    case 'star':
      return <Star />
  }
}

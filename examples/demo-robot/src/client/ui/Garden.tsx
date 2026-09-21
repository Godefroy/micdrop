import { CSSProperties } from 'react'
import { GameState } from '../game/Game'
import { EMOJI, Entity, HEIGHT, TERRAIN, WIDTH } from '../game/world'
import Robot from './Robot'

/** The garden from above, sized in `cqw` so it scales with the window */
export default function Garden({ state }: { state: GameState }) {
  const held = state.entities.find((e) => e.id === state.robot.holding)

  return (
    <div className="garden relative w-full overflow-hidden rounded-3xl bg-[#6bbf59] shadow-2xl ring-4 ring-[#3d7a31]">
      <Terrain />

      {state.entities
        .filter((e) => !e.gone && !e.held)
        .map((entity) => (
          <Thing key={entity.id} entity={entity} />
        ))}

      <Robot robot={state.robot} held={held} />

      {state.effects.map((effect) => (
        <div
          key={effect.id}
          className="animate-float-up pointer-events-none absolute z-30 whitespace-nowrap text-[2.2cqw] font-bold drop-shadow"
          style={{
            ...at(effect.x + 0.5, effect.y),
            transform: 'translate(-50%, 0)',
          }}
        >
          {effect.emoji}
        </div>
      ))}
    </div>
  )
}

function Terrain() {
  const tiles = []
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const tile = TERRAIN[y][x]
      if (tile === '.') {
        if ((x + y) % 2) {
          tiles.push(
            <div
              key={`${x}-${y}`}
              className="tile bg-[#63b451]"
              style={at(x, y)}
            />
          )
        }
      } else if (tile === '=') {
        tiles.push(
          <div
            key={`${x}-${y}`}
            className="tile bg-[#d9c089]"
            style={at(x, y)}
          />
        )
      } else if (tile === '~') {
        tiles.push(
          <div key={`${x}-${y}`} className="tile bg-[#3b8fd9]" style={at(x, y)}>
            <div className="animate-ripple h-full w-full bg-[radial-gradient(circle_at_30%_40%,#ffffff55_8%,transparent_30%)]" />
          </div>
        )
      }
    }
  }

  return (
    <>
      {tiles}
      {/* The house covers its 4 × 3 tiles at once */}
      <div
        className="absolute flex items-center justify-center rounded-br-2xl bg-[#b5543c] text-[9cqw] shadow-inner"
        style={{ left: 0, top: 0, width: '25%', height: '30%' }}
      >
        🏡
      </div>
    </>
  )
}

function Thing({ entity }: { entity: Entity }) {
  const thirsty = entity.kind === 'flower' && !entity.on
  const lampOn = entity.kind === 'lamp' && entity.on
  const dim = entity.kind === 'lamp' && !entity.on

  return (
    <div
      className="tile glide z-10 flex items-center justify-center text-[4cqw]"
      style={at(entity.x, entity.y)}
    >
      {lampOn && (
        <div className="absolute h-[300%] w-[300%] rounded-full bg-[radial-gradient(circle,#fff59d99_0%,transparent_65%)]" />
      )}
      <span
        className="relative transition-all duration-500"
        style={
          thirsty
            ? {
                filter: 'grayscale(0.85) brightness(0.8)',
                transform: 'rotate(18deg) scale(0.8)',
              }
            : dim
              ? { filter: 'grayscale(1) brightness(0.7)' }
              : undefined
        }
      >
        {EMOJI[entity.kind]}
      </span>
      {entity.kind === 'chest' && entity.on && (
        <span className="absolute -top-[20%] text-[2cqw]">✨</span>
      )}
    </div>
  )
}

/** Where a tile sits, in percents of the garden */
export function at(x: number, y: number): CSSProperties {
  return { left: `${(x / WIDTH) * 100}%`, top: `${(y / HEIGHT) * 100}%` }
}

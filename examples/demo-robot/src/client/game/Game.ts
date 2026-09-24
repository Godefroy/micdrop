import { Command, Direction, Step, Target } from '../../shared/commands'
import { sound } from './sound'
import {
  Entity,
  initialEntities,
  Kind,
  LIKES,
  PETS,
  PICKABLE,
  Quest,
  QUESTS,
  tileAt,
  WIDTH,
} from './world'

export type Mood = 'neutral' | 'happy' | 'sad' | 'confused' | 'sleepy'
export type Trick = 'dance' | 'wave' | 'spin' | 'jump' | 'chop'

export interface Robot {
  x: number
  y: number
  facing: Direction
  holding?: string
  mood: Mood
  trick?: Trick
  bubble?: string
}

/** An emoji floating up from a tile: hearts, drops, sparkles */
export interface Effect {
  id: number
  x: number
  y: number
  emoji: string
}

export interface GameState {
  robot: Robot
  entities: Entity[]
  quests: Record<Quest, boolean>
  effects: Effect[]
  /** Commands waiting behind the one being played */
  waiting: number
  won: boolean
}

type Place = 'pond' | 'house'
type Position = { x: number; y: number }

const STEP_MS = 170
const MAX_PATH = 80

const MOVES: Record<Direction, Position> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

/** The targets Bip can carry */
const CARRIABLE: Target[] = [
  'bucket',
  'ball',
  'apple',
  'banana',
  'wood',
  'fish',
]

/** Thrown by a pause once a stop cancelled what was playing */
class Stopped extends Error {}

/**
 * The garden and everything Bip does in it. Commands from Jev queue up and
 * play one after the other, step by step, and a stop cancels them at once.
 */
export class Game {
  private state: GameState = {
    robot: { x: 8, y: 5, facing: 'down', mood: 'neutral' },
    entities: initialEntities(),
    quests: {
      hello: false,
      lamp: false,
      flower: false,
      ball: false,
      treat: false,
      fish: false,
      tree: false,
      chest: false,
    },
    effects: [],
    waiting: 0,
    won: false,
  }
  private listeners = new Set<() => void>()
  private queue: Command[] = []
  private running = false
  private generation = 0
  private effectId = 0
  private bubbleTimer?: ReturnType<typeof setTimeout>
  private petTimer?: ReturnType<typeof setInterval>
  // A pet that just reacted stays put a moment, so its reaction is seen
  private busyPets = new Set<string>()

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    if (!this.petTimer) this.petTimer = setInterval(this.wanderPets, 3000)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = () => this.state

  /** Plays what Jev read in a turn */
  command(command: Command) {
    if (command.stop) {
      this.generation++
      this.queue = []
      this.setRobot({ trick: undefined })
      this.say('Stopping! 🛑')
      if (!command.steps.length) return
    }
    this.queue.push(command)
    this.set({ waiting: this.queue.length - (this.running ? 0 : 1) })
    this.run()
  }

  private async run() {
    if (this.running) return
    this.running = true
    while (this.queue.length) {
      const command = this.queue.shift()!
      this.set({ waiting: this.queue.length })
      try {
        await this.play(command, this.generation)
      } catch (error) {
        if (!(error instanceof Stopped)) console.error(error)
      }
    }
    this.running = false
    if (this.state.robot.mood !== 'sad') this.setRobot({ mood: 'neutral' })
  }

  private async play(command: Command, generation: number) {
    const pause = (ms: number) => this.pause(ms, generation)

    if (command.rude) {
      this.say('Beep… that hurts my circuits. 😢', 'sad')
      await pause(1200)
    } else if (command.praise) {
      this.say('Aww, thank you! 🥰', 'happy')
      this.effect('💖')
      this.setRobot({ trick: 'jump' })
      await pause(900)
      this.setRobot({ trick: undefined })
    } else if (command.polite) {
      this.effect('❤️')
      this.setRobot({ mood: 'happy' })
    }

    if (command.hello && !command.steps.some((s) => s.action === 'wave')) {
      await this.trick('wave', pause)
    }

    // "Fetch the ball and bring it to the cat": the second step says "it",
    // which is the last thing to carry an earlier step named
    let mentioned: Target | undefined
    for (const step of command.steps) {
      await this.step(step, pause, mentioned)
      if (step.target && CARRIABLE.includes(step.target)) {
        mentioned = step.target
      }
    }

    if (
      !command.steps.length &&
      !command.hello &&
      !command.praise &&
      !command.rude &&
      !command.stop
    ) {
      this.say("Beep? I didn't get that. 🤔", 'confused')
      sound.error()
      await pause(800)
    }
  }

  private async step(step: Step, pause: Pause, mentioned?: Target) {
    switch (step.action) {
      case 'go':
        return this.go(step.target, pause)
      case 'move':
        return this.move(step.direction, step.amount, pause)
      case 'pick_up':
        return this.pickUp(step.target, pause)
      case 'drop':
        return this.drop()
      case 'put': {
        // "Give the banana to the dog" names the object: grab it first. With
        // empty hands and no object named, it is the one mentioned before.
        const named = step.receiver ? step.target : undefined
        const object =
          named && CARRIABLE.includes(named)
            ? named
            : this.state.robot.holding
              ? undefined
              : mentioned
        if (object && this.needsPickUp(object)) {
          await this.pickUp(object, pause)
        }
        return this.put(step.receiver ?? step.target, pause)
      }
      case 'water':
        return this.water(step.target, pause)
      case 'use':
        return this.use(step.target, pause)
      case 'pet':
        return this.pet(step.target, pause)
      case 'kick':
        return this.kick(pause)
      case 'cut':
        return this.cut(step.target, pause)
      case 'fish':
        return this.fish(pause)
      default:
        return this.trick(step.action, pause)
    }
  }

  // Actions

  private async go(target: Target | undefined, pause: Pause) {
    const goal = this.resolve(target, 'go')
    if (!goal) return this.confused('Go where? 🤔')
    const arrived =
      typeof goal === 'string'
        ? await this.walkToPlace(goal, pause)
        : await this.walkTo(goal.id, pause)
    if (arrived) this.say(`Here I am! ${goal === 'pond' ? '🌊' : '📍'}`)
  }

  private async move(
    direction: Direction | undefined,
    amount: number,
    pause: Pause
  ) {
    if (!direction) return this.confused('Which way? 🧭')
    for (let i = 0; i < amount; i++) {
      const next = add(this.state.robot, MOVES[direction])
      this.setRobot({ facing: direction })
      if (!this.walkable(next)) {
        sound.error()
        return this.say('Bonk! Something is in the way. 🤕', 'confused')
      }
      this.setRobot(next)
      sound.step()
      await pause(STEP_MS * 1.5)
    }
  }

  private async pickUp(target: Target | undefined, pause: Pause) {
    // No fish yet: there is one to catch in the pond
    if (target === 'fish' && !this.find('fish')) return this.fish(pause)
    const goal = this.resolve(target, 'pick_up')
    if (!goal || typeof goal === 'string')
      return this.confused('Pick up what? 🤔')
    if (PETS.includes(goal.kind)) {
      this.petSays(goal, goal.kind === 'cat' ? 'Hiss! 🙀' : 'Grrr… 🐕')
      return this.say(
        `The ${goal.kind} does not want to be carried.`,
        'confused'
      )
    }
    if (goal.kind === 'apple_tree') {
      if (!(await this.walkTo(goal.id, pause))) return
      if (!this.dropHeld()) return
      const apple: Entity = {
        id: `apple-${Date.now()}`,
        kind: 'apple',
        x: this.state.robot.x,
        y: this.state.robot.y,
        held: true,
      }
      this.set({ entities: [...this.state.entities, apple] })
      this.setRobot({ holding: apple.id })
      sound.pick()
      return this.say('Picked a shiny apple! 🍎', 'happy')
    }
    if (!PICKABLE.includes(goal.kind)) {
      sound.error()
      return this.say("That's way too heavy for me! 😅", 'confused')
    }
    if (this.state.robot.holding === goal.id)
      return this.say('Already got it! 😎')
    if (!(await this.walkTo(goal.id, pause))) return
    if (!this.dropHeld()) return
    this.setEntity(goal.id, { held: true })
    this.setRobot({ holding: goal.id })
    sound.pick()
    this.say(`Got the ${label(goal.kind)}!`, 'happy')
  }

  private drop() {
    if (!this.state.robot.holding) return this.say('My hands are empty. 🤷')
    if (this.dropHeld()) sound.drop()
  }

  private async put(target: Target | undefined, pause: Pause) {
    const held = this.held()
    if (!held) return this.confused("I'm not holding anything! 🤲")
    const goal = this.resolve(target, 'put')
    // A step can name the thing rather than where it goes
    if (!goal || goal === held) return this.drop()
    if (goal === 'pond') {
      if (!(await this.walkToPlace('pond', pause))) return
      if (held.kind === 'bucket')
        return this.say('Bucket refilled! 💧', 'happy')
      this.release(held.id, { gone: true })
      sound.splash()
      this.effect('💦')
      return this.say('Splash! Gone with the fishes. 🐟')
    }
    if (goal === 'house') {
      if (!(await this.walkToPlace(goal, pause))) return
      if (held.kind !== 'wood') return this.drop()
      this.release(held.id, { gone: true })
      this.effect('🔥')
      sound.success()
      return this.say('A cozy fire in the chimney! 🔥', 'happy')
    }
    if (goal.kind === 'flower' && held.kind === 'bucket') {
      return this.water('flower', pause)
    }
    if (!(await this.walkTo(goal.id, pause))) return
    if (PETS.includes(goal.kind)) return this.give(goal, held)

    switch (goal.kind) {
      case 'chest':
        this.release(held.id, { gone: true })
        sound.drop()
        return this.say('Safely stored in the chest. 🔒')

      default:
        this.dropHeld(goal)
        sound.drop()
    }
  }

  /** Hands a pet something, which it loves or snubs */
  private give(pet: Entity, held: Entity) {
    if (!LIKES[pet.kind]?.includes(held.kind)) {
      this.dropHeld(pet)
      this.petSays(pet, pet.kind === 'cat' ? 'Pff. 😾' : 'Sniff… 🤨')
      return this.say(`The ${pet.kind} is not into that. 🤷`)
    }
    if (held.kind === 'ball') {
      if (!this.dropHeld(pet)) return
      this.petSays(pet, pet.kind === 'cat' ? 'Meow! ⚽' : 'Woof woof! ⚽', '✨')
      this.progress('ball')
      return this.say('Play time! 🐾', 'happy')
    }
    this.release(held.id, { gone: true })
    this.petSays(pet, pet.kind === 'cat' ? 'Nom nom! 😻' : 'Chomp! 🐶', '💕')
    if (held.kind === 'fish') this.progress('fish')
    else if (held.kind === 'apple' || held.kind === 'banana') {
      this.progress('treat')
    }
    this.say(
      held.kind === 'wood'
        ? 'Best stick ever, apparently! 🪵'
        : `The ${pet.kind} loves it! 💕`,
      'happy'
    )
  }

  private async water(target: Target | undefined, pause: Pause) {
    if (this.held()?.kind !== 'bucket') {
      this.say('Let me grab the bucket first! 🪣')
      await this.pickUp('bucket', pause)
      if (this.held()?.kind !== 'bucket') return
    }
    const goal = this.resolve(target ?? 'flower', 'water')
    if (!goal || typeof goal === 'string' || goal.kind !== 'flower') {
      return this.confused('Water what? 🌼')
    }
    if (!(await this.walkTo(goal.id, pause))) return
    if (goal.on) return this.say('This one is already fresh! 🌸')
    sound.splash()
    this.effect('💧', goal)
    await pause(500)
    this.setEntity(goal.id, { on: true })
    this.effect('🌟', goal)
    sound.success()
    this.progress('flower')
    this.say('Look how happy it is! 🌸', 'happy')
  }

  private async use(target: Target | undefined, pause: Pause) {
    const goal = this.resolve(target, 'use')
    if (!goal || typeof goal === 'string') return this.confused('Use what? 🤔')
    if (!(await this.walkTo(goal.id, pause))) return

    switch (goal.kind) {
      case 'lamp': {
        const on = !goal.on
        this.setEntity(goal.id, { on })
        sound.pick()
        if (on) this.progress('lamp')
        return this.say(on ? 'Let there be light! 💡' : 'Lights out. 🌙')
      }
      case 'chest': {
        if (goal.on) return this.say('Already open! 🧰')
        this.setEntity(goal.id, { on: true })
        // The star rises out of the chest, on its tile
        const star: Entity = { id: 'star', kind: 'star', x: goal.x, y: goal.y }
        this.set({ entities: [...this.state.entities, star] })
        this.effect('✨', goal)
        sound.success()
        this.progress('chest')
        return this.say('A golden star! ⭐', 'happy')
      }
      default:
        return this.confused("I don't know how to use that. 🤷")
    }
  }

  private async pet(target: Target | undefined, pause: Pause) {
    const goal = this.resolve(target, 'pet')
    const pet =
      goal && typeof goal !== 'string' && PETS.includes(goal.kind)
        ? goal
        : this.resolve('cat', 'pet')
    if (!pet || typeof pet === 'string') return
    if (!(await this.walkTo(pet.id, pause))) return
    this.petSays(pet, pet.kind === 'cat' ? 'Purrr… 😽' : 'Wag wag! 🐶', '💕')
    this.say('So soft! 🥹', 'happy')
  }

  private async cut(target: Target | undefined, pause: Pause) {
    const goal = this.resolve(target ?? 'tree', 'cut')
    if (goal && typeof goal !== 'string' && goal.kind === 'apple_tree') {
      return this.say("I'd rather keep the apples! 🍎", 'confused')
    }
    const tree =
      goal && typeof goal !== 'string' && goal.kind === 'tree'
        ? goal
        : this.resolve('tree', 'cut')
    if (!tree || typeof tree === 'string') {
      return this.confused('No tree left to cut! 🌲')
    }
    if (!(await this.walkTo(tree.id, pause))) return
    this.setRobot({ trick: 'chop' })
    for (let i = 0; i < 3; i++) {
      sound.chop()
      this.effect('🪓', tree)
      await pause(350)
    }
    this.setRobot({ trick: undefined })
    this.setEntity(tree.id, { kind: 'wood' })
    sound.success()
    this.progress('tree')
    this.say('Timber! 🌲 Some wood for later.', 'happy')
  }

  /** Casts a line from the shore, and comes back with a fish */
  private async fish(pause: Pause) {
    if (!(await this.walkToPlace('pond', pause))) return
    if (!this.dropHeld()) return
    this.say('Fishing… 🎣')
    this.effect('🎣')
    await pause(1600)
    const fish: Entity = {
      id: `fish-${Date.now()}`,
      kind: 'fish',
      ...this.state.robot,
      held: true,
    }
    this.set({ entities: [...this.state.entities, fish] })
    this.setRobot({ holding: fish.id })
    sound.splash()
    this.effect('💦')
    this.say('Got one! 🐟', 'happy')
  }

  private async kick(pause: Pause) {
    let ball = this.find('ball')!
    if (ball.held) {
      this.dropHeld()
      ball = this.find('ball')!
    } else {
      const reached = await this.walkTo(ball.id, pause)
      if (!reached) return
    }

    // The ball rolls away from Bip, until something stops it
    const robot = this.state.robot
    let direction = MOVES[robot.facing]
    if (ball.x !== robot.x || ball.y !== robot.y) {
      direction = {
        x: Math.sign(ball.x - robot.x),
        y: Math.sign(ball.y - robot.y),
      }
    }
    sound.kick()
    this.say('Goooal! ⚽', 'happy')
    for (let i = 0; i < 5; i++) {
      const next = add(this.find('ball')!, direction)
      const pet = this.petAt(next)
      if (pet) {
        this.petSays(pet, pet.kind === 'cat' ? 'Meow?! 🙀' : 'Woof?! 🐕')
        break
      }
      if (!this.walkable(next)) break
      this.setEntity('ball', next)
      await pause(90)
    }
    const rolled = this.find('ball')!
    const pet = PETS.map((kind) => this.find(kind)!).find((p) =>
      isNextTo(ball, p)
    )
    if (pet) {
      this.petSays(pet, pet.kind === 'cat' ? 'Meow! ⚽' : 'Woof woof! ⚽', '✨')
      this.progress('ball')
    }
  }

  private async trick(trick: Trick | string, pause: Pause) {
    const name = trick as Trick
    this.setRobot({ trick: name, mood: 'happy' })
    if (name === 'wave') {
      this.say('Hello! Beep boop! 👋', 'happy')
      this.progress('hello')
    } else if (name === 'dance') {
      this.say('♪ ┏(・o･)┛ ♪', 'happy')
      this.effect('🎵')
    }
    await pause(name === 'dance' ? 2000 : 1100)
    this.setRobot({ trick: undefined })
  }

  // Moving around

  /** Walks next to a thing, which stays in sight rather than under Bip */
  private async walkTo(id: string, pause: Pause): Promise<boolean> {
    return this.walk(
      (position) => {
        const entity = this.state.entities.find((e) => e.id === id)!
        return entity.held || isNextTo(position, entity)
      },
      pause,
      () => this.state.entities.find((e) => e.id === id)
    )
  }

  private walkToPlace(place: Place, pause: Pause) {
    const tile = place === 'pond' ? '~' : 'H'
    return this.walk(
      (position) =>
        Object.values(MOVES).some(
          (move) => tileAt(position.x + move.x, position.y + move.y) === tile
        ),
      pause
    )
  }

  /** Steps towards the goal, finding the way again at each tile, since pets move */
  private async walk(
    isGoal: (position: Position) => boolean,
    pause: Pause,
    lookAt?: () => Entity | undefined
  ): Promise<boolean> {
    for (let steps = 0; steps < MAX_PATH; steps++) {
      if (isGoal(this.state.robot)) {
        const target = lookAt?.()
        if (target && !target.held) this.face(target)
        return true
      }
      const next = this.nextStep(isGoal)
      if (!next) {
        sound.error()
        this.say("I can't get there! 😵", 'confused')
        return false
      }
      this.face(next)
      this.setRobot(next)
      sound.step()
      await pause(STEP_MS)
    }
    return false
  }

  /** Breadth first search, returning the first tile of the shortest path */
  private nextStep(
    isGoal: (position: Position) => boolean
  ): Position | undefined {
    const start = this.state.robot
    const key = (p: Position) => p.y * WIDTH + p.x
    const firstStep = new Map<number, Position>()
    const seen = new Set([key(start)])
    const queue: Position[] = []
    for (const move of Object.values(MOVES)) {
      const next = add(start, move)
      if (!this.walkable(next) || seen.has(key(next))) continue
      seen.add(key(next))
      firstStep.set(key(next), next)
      queue.push(next)
    }
    while (queue.length) {
      const current = queue.shift()!
      if (isGoal(current)) return firstStep.get(key(current))
      for (const move of Object.values(MOVES)) {
        const next = add(current, move)
        if (!this.walkable(next) || seen.has(key(next))) continue
        seen.add(key(next))
        firstStep.set(key(next), firstStep.get(key(current))!)
        queue.push(next)
      }
    }
    return undefined
  }

  private walkable(position: Position) {
    const tile = tileAt(position.x, position.y)
    if (!tile || tile === '~' || tile === 'H') return false
    // Everything on the ground is walked around, so it stays in sight
    return !this.state.entities.some(
      (e) => !e.gone && !e.held && e.x === position.x && e.y === position.y
    )
  }

  private face(target: Position) {
    const { x, y } = this.state.robot
    const dx = target.x - x
    const dy = target.y - y
    if (!dx && !dy) return
    const facing: Direction =
      Math.abs(dx) > Math.abs(dy)
        ? dx > 0
          ? 'right'
          : 'left'
        : dy > 0
          ? 'down'
          : 'up'
    this.setRobot({ facing })
  }

  // The things in the garden

  /** Which thing a target means, the nearest one when several fit */
  private resolve(
    target: Target | undefined,
    action: string
  ): Entity | Place | undefined {
    if (!target) return undefined
    if (target === 'pond' || target === 'house') return target
    const present = this.state.entities.filter((e) => !e.gone)
    const nearest = (entities: Entity[]) =>
      entities.sort(
        (a, b) => distance(this.state.robot, a) - distance(this.state.robot, b)
      )[0]

    if (target === 'apple') {
      return (
        nearest(present.filter((e) => e.kind === 'apple')) ??
        this.find('apple_tree')
      )
    }
    return nearest(present.filter((e) => e.kind === target))
  }

  private find(kind: Kind) {
    return this.state.entities.find((e) => e.kind === kind && !e.gone)
  }

  /** Whether a target is a thing to carry that Bip does not hold yet */
  private needsPickUp(target: Target) {
    // A fish still in the pond has to be caught
    if (target === 'fish' && !this.find('fish')) return true
    const goal = this.resolve(target, 'pick_up')
    return (
      !!goal &&
      typeof goal !== 'string' &&
      PICKABLE.includes(goal.kind) &&
      goal.id !== this.state.robot.holding
    )
  }

  private held() {
    const id = this.state.robot.holding
    return id ? this.state.entities.find((e) => e.id === id) : undefined
  }

  /**
   * Puts down what Bip holds on a free tile next to it: the one closest to
   * `toward` when given, the one in front of it otherwise.
   */
  private dropHeld(toward?: Position): boolean {
    const held = this.held()
    if (!held) return true
    const robot = this.state.robot
    const aim = toward ?? add(robot, MOVES[robot.facing])
    const spot = Object.values(MOVES)
      .map((move) => add(robot, move))
      .filter((next) => this.walkable(next))
      .sort((a, b) => distance(a, aim) - distance(b, aim))[0]
    if (!spot) {
      this.confused('No room to put it down here! 📦')
      return false
    }
    this.release(held.id, spot)
    return true
  }

  private release(id: string, patch: Partial<Entity>) {
    this.setEntity(id, { held: false, ...patch })
    this.setRobot({ holding: undefined })
  }

  private petAt(position: Position) {
    return this.state.entities.find(
      (e) => PETS.includes(e.kind) && e.x === position.x && e.y === position.y
    )
  }

  private wanderPets = () => {
    const { robot } = this.state
    for (const kind of PETS) {
      const pet = this.find(kind)
      if (!pet || this.busyPets.has(pet.id) || Math.random() < 0.4) continue
      const moves = Object.values(MOVES)
      const next = add(pet, moves[Math.floor(Math.random() * moves.length)])
      if (next.y < 3 || !this.walkable(next)) continue
      if (next.x === robot.x && next.y === robot.y) continue
      this.setEntity(pet.id, next)
    }
  }

  private petSays(pet: Entity, text: string, emoji?: string) {
    if (pet.kind === 'cat') sound.meow()
    else sound.woof()
    this.effect(emoji ?? '💬', pet, text)
    this.busyPets.add(pet.id)
    setTimeout(() => this.busyPets.delete(pet.id), 4000)
  }

  // Feedback

  private say(text: string, mood: Mood = 'neutral') {
    this.setRobot({ bubble: text, mood })
    sound.talk(mood === 'happy' ? 'happy' : mood === 'sad' ? 'sad' : 'neutral')
    clearTimeout(this.bubbleTimer)
    this.bubbleTimer = setTimeout(
      () => this.setRobot({ bubble: undefined }),
      2600
    )
  }

  private confused(text: string) {
    sound.error()
    this.say(text, 'confused')
  }

  private effect(
    emoji: string,
    at: Position = this.state.robot,
    text?: string
  ) {
    const effect = {
      id: ++this.effectId,
      x: at.x,
      y: at.y,
      emoji: text ? `${emoji} ${text}` : emoji,
    }
    this.set({ effects: [...this.state.effects, effect] })
    setTimeout(() => {
      this.set({
        effects: this.state.effects.filter((e) => e.id !== effect.id),
      })
    }, 1600)
  }

  private progress(quest: Quest) {
    const quests = { ...this.state.quests, [quest]: true }
    this.set({ quests })

    const won = (Object.keys(QUESTS) as Quest[]).every((key) => quests[key])
    if (won && !this.state.won) {
      this.set({ won: true })
      setTimeout(() => {
        sound.success()
        this.say("All quests done! You're a robot whisperer! 🏆", 'happy')
        this.setRobot({ trick: 'dance' })
        setTimeout(() => this.setRobot({ trick: undefined }), 2500)
      }, 1200)
    }
  }

  // State

  private pause(ms: number, generation: number) {
    return new Promise<void>((resolve, reject) =>
      setTimeout(
        () =>
          generation === this.generation ? resolve() : reject(new Stopped()),
        ms
      )
    )
  }

  private set(patch: Partial<GameState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((listener) => listener())
  }

  private setRobot(patch: Partial<Robot>) {
    this.set({ robot: { ...this.state.robot, ...patch } })
  }

  private setEntity(id: string, patch: Partial<Entity>) {
    this.set({
      entities: this.state.entities.map((e) =>
        e.id === id ? { ...e, ...patch } : e
      ),
    })
  }
}

type Pause = (ms: number) => Promise<void>

function add(position: Position, move: Position): Position {
  return { x: position.x + move.x, y: position.y + move.y }
}

function distance(a: Position, b: Position) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
}

function isNextTo(a: Position, b: Position) {
  return distance(a, b) === 1
}

function label(kind: Kind) {
  return kind.replace('_', ' ')
}

export const game = new Game()

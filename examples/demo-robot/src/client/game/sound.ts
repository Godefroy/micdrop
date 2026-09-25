import { audioContext } from '@micdrop/web'

/**
 * Bip speaks in beeps: no text to speech, a few square waves on the audio
 * context the call already opened.
 */
function tone(
  output: AudioNode,
  frequency: number,
  start: number,
  duration: number,
  type: OscillatorType = 'square',
  volume = 0.04
) {
  const oscillator = audioContext.createOscillator()
  const gain = audioContext.createGain()
  oscillator.type = type
  oscillator.frequency.setValueAtTime(frequency, start)
  gain.gain.setValueAtTime(volume, start)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  oscillator.connect(gain).connect(output)
  oscillator.start(start)
  oscillator.stop(start + duration)
}

/**
 * The sounds of one robot, placed left or right: with two robots side by
 * side, each is heard on its own side
 * @param pan - From -1, left, to 1, right
 */
export function createSound(pan = 0) {
  let output: AudioNode | undefined
  const play = (notes: Array<[number, number]>, type?: OscillatorType) => {
    if (audioContext.state !== 'running') return
    if (!output) {
      const panner = audioContext.createStereoPanner()
      panner.pan.value = pan
      panner.connect(audioContext.destination)
      output = panner
    }
    let time = audioContext.currentTime
    for (const [frequency, duration] of notes) {
      tone(output, frequency, time, duration, type)
      time += duration * 0.9
    }
  }
  return sounds(play)
}

export type Sound = ReturnType<typeof createSound>

type Play = (notes: Array<[number, number]>, type?: OscillatorType) => void

const sounds = (play: Play) => ({
  step: () => play([[220, 0.04]], 'triangle'),
  /** A random beep-boop, a few notes long, when Bip says something */
  talk: (mood: 'happy' | 'sad' | 'neutral' = 'neutral') => {
    const base = mood === 'happy' ? 700 : mood === 'sad' ? 260 : 480
    const notes: Array<[number, number]> = []
    for (let i = 0; i < 4; i++) {
      notes.push([
        base + Math.random() * 300 - (mood === 'sad' ? i * 40 : 0),
        0.07,
      ])
    }
    play(notes)
  },
  pick: () =>
    play([
      [520, 0.06],
      [780, 0.08],
    ]),
  drop: () =>
    play([
      [520, 0.06],
      [330, 0.08],
    ]),
  success: () =>
    play([
      [523, 0.09],
      [659, 0.09],
      [784, 0.09],
      [1047, 0.18],
    ]),
  error: () =>
    play(
      [
        [180, 0.15],
        [140, 0.2],
      ],
      'sawtooth'
    ),
  splash: () =>
    play(
      [
        [900, 0.05],
        [600, 0.05],
        [1200, 0.05],
      ],
      'sine'
    ),
  kick: () => play([[120, 0.08]], 'square'),
  woof: () =>
    play(
      [
        [300, 0.07],
        [220, 0.12],
      ],
      'sawtooth'
    ),
  chop: () =>
    play(
      [
        [160, 0.05],
        [90, 0.06],
      ],
      'square'
    ),
  meow: () =>
    play(
      [
        [880, 0.08],
        [660, 0.18],
      ],
      'sine'
    ),
})

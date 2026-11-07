import { Pcm16Resampler, SentenceSplitter, TTS } from '@micdrop/server'
import { ChildProcessWithoutNullStreams, spawn } from 'child_process'
import { defaultConfigPath, PiperVoiceConfig, readVoiceConfig } from './config'

/**
 * Local Piper text to speech, driving the piper binary as a subprocess.
 *
 * Piper reads one utterance per line on its standard input and writes raw
 * PCM16 on its standard output. Voices are small VITS models, a few dozen
 * megabytes each, covering around forty languages, which is what makes this
 * the option to reach for outside English.
 *
 * The process is kept alive across sentences. Loading a voice costs about a
 * second while synthesizing takes almost no time on top of it, so spawning one
 * process per sentence would pay that second again on every sentence. Keeping
 * one process means the audio of consecutive sentences arrives as a single
 * stream, with no way to tell where one ends, so an interruption arriving while
 * it is still writing audio is handled by killing the process outright and
 * starting the replacement immediately: the new one loads its voice while the
 * user is still speaking, and is ready by the time the next answer starts.
 *
 * The binary and the voice files are installed separately, see the README.
 *
 * @see https://github.com/OHF-Voice/piper1-gpl
 */

export interface PiperTTSOptions {
  /** Path to the `.onnx` voice file, for instance `fr_FR-siwis-medium.onnx`. */
  modelPath: string

  /** Voice configuration, `<modelPath>.json` by default. */
  configPath?: string

  /** Piper executable, looked up in the PATH by default. */
  binaryPath?: string

  /** Speaker index, for the voices that hold several. */
  speaker?: number

  /** Duration multiplier, above 1 to slow the voice down. */
  lengthScale?: number

  /** Variability of the generated speech. */
  noiseScale?: number

  /** Variability of the phoneme durations. */
  noiseWidth?: number

  /** Silence added after each sentence, in seconds. */
  sentenceSilence?: number

  /** Volume multiplier, 1 being the level the voice was trained at. */
  volume?: number
}

const DEFAULT_BINARY = 'piper'
const OUTPUT_SAMPLE_RATE = 16000 // Rate expected by the Micdrop client
// Piper marks neither the end of an utterance nor of its queue on standard
// output. Once it has written some audio after the last sentence it was given
// and then stayed silent this long, it is taken to have said everything. It
// writes a whole sentence in a fraction of this, faster than real time.
const QUIET_DELAY = 1000

/**
 * Where the Piper process stands.
 *
 * - `none`: no process, the next sentence starts one.
 * - `clean`: a process holding no audio back, either never given text or done
 *   writing all of it. A cancel keeps it, muted: audio coming out after all
 *   was still owed to the cancelled answer, so it is dropped, and the process
 *   is replaced before the next sentence.
 * - `dirty`: a process that may still be writing the audio of a sentence. A
 *   cancel kills it and starts another, the only way to cut that audio.
 * - `failed`: the binary cannot be run at all (missing, not executable). The
 *   failure was reported once, and nothing is tried again.
 * - `destroyed`: the instance is done for.
 */
type ProcessState =
  | { status: 'none' }
  | {
      status: 'clean'
      child: ChildProcessWithoutNullStreams
      // Cancelled since its last sentence, nothing it says is wanted
      muted?: boolean
      // Spoke while muted, so it still holds audio of the cancelled answer
      stale?: boolean
    }
  | {
      status: 'dirty'
      child: ChildProcessWithoutNullStreams
      // Started by the first audio after the last sentence written, so the
      // silence of a process still loading its voice does not count as done
      quietTimer?: NodeJS.Timeout
    }
  | { status: 'failed' }
  | { status: 'destroyed' }

// Spawn errors that a retry cannot fix
const FATAL_SPAWN_ERRORS = ['ENOENT', 'EACCES', 'ENOTDIR']

export class PiperTTS extends TTS {
  private config: Promise<PiperVoiceConfig>
  private splitter = new SentenceSplitter()
  private state: ProcessState = { status: 'none' }
  // Bumped by every speak() and every cancel(), so a call claimed late can tell
  // whether it is still the one that should be heard
  private generation = 0
  private counter = 0 // Identifies the current speak() call

  constructor(private readonly options: PiperTTSOptions) {
    super()
    this.config = readVoiceConfig(
      options.configPath ?? defaultConfigPath(options.modelPath)
    )
    this.config.catch((error) => {
      console.error('[PiperTTS] Failed to read voice config:', error)
    })
    // Load the voice now rather than on the first sentence of the call. A
    // sentence arriving before the config is read spawns the process itself,
    // hence the guard: replacing it here would orphan the text it was given.
    this.config
      .then(() => {
        if (this.state.status === 'none') this.spawnChild()
      })
      .catch(() => {})
  }

  speak(textStream: NodeJS.ReadableStream) {
    const generation = ++this.generation
    let counter = 0

    // Claiming the call is deferred until there is something to say, so an
    // answer skipped by a tool or by onBeforeAnswer leaves the sentences still
    // being spoken alone instead of cutting the assistant off.
    const claimCall = () => {
      if (counter) return true
      if (this.generation !== generation) return false
      this.counter++
      counter = this.counter
      this.splitter.reset()
      return true
    }

    textStream.on('data', (chunk: Buffer) => {
      if (!claimCall()) return
      if (counter !== this.counter) return
      this.write(counter, this.splitter.push(chunk.toString('utf-8')))
    })

    textStream.on('error', (error) => {
      this.log('Error in text stream', error)
    })

    textStream.on('end', () => {
      // Nothing was ever said, so there is nothing left to flush
      if (!counter || counter !== this.counter) return
      this.write(counter, this.splitter.flush())
    })
  }

  cancel() {
    this.log('Cancel')
    this.generation++
    this.counter++
    this.splitter.reset()

    // A process holding no audio back is kept as it is rather than paying for
    // another voice load. The server cancels before every answer, so this is
    // the common case.
    if (this.state.status === 'clean') {
      this.state.muted = true
      return
    }
    if (this.state.status !== 'dirty') return
    this.killChild()
    this.spawnChild()
  }

  destroy() {
    super.destroy()
    this.killChild()
    this.state = { status: 'destroyed' }
  }

  private write(counter: number, sentences: string[]) {
    if (sentences.length === 0) return
    if (counter !== this.counter) return

    // It went quiet longer than a sentence takes, yet still had audio of the
    // cancelled answer: only a new process keeps it out of this one
    if (this.state.status === 'clean' && this.state.stale) this.killChild()
    const child = this.spawnChild()
    if (!child) return

    for (const sentence of sentences) {
      this.log(`Synthesizing: "${sentence}"`)
      // Piper reads one utterance per line, so the sentence has to be flat
      child.stdin.write(`${sentence.replace(/\s+/g, ' ').trim()}\n`)
    }
    this.setDirty(child)
  }

  /** Returns the running process, starting one if there is none. */
  private spawnChild(): ChildProcessWithoutNullStreams | undefined {
    const { state } = this
    if (state.status === 'clean' || state.status === 'dirty') return state.child
    if (state.status !== 'none') return undefined

    const binary = this.options.binaryPath ?? DEFAULT_BINARY
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(binary, this.getArguments(), {
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    } catch (error) {
      console.error(`[PiperTTS] Cannot run "${binary}":`, error)
      return undefined
    }

    this.state = { status: 'clean', child }

    // One resampler per process: its audio is a single continuous stream, and
    // a new process starts a new one
    const resampler = this.config.then(
      ({ sampleRate }) => new Pcm16Resampler(sampleRate, OUTPUT_SAMPLE_RATE)
    )

    let pending: Promise<void> = Promise.resolve()
    child.stdout.on('data', (chunk: Buffer) => {
      const { state } = this
      if (state.status === 'clean' && state.child === child && state.muted) {
        state.stale = true
        return
      }
      this.handleOutput(child)
      // Chunks are resampled in the order they arrive, the resampler carries
      // its fractional position from one to the next
      pending = pending.then(async () => {
        const output = (await resampler).process(chunk)
        // The process may have been replaced, or muted by a cancel, while
        // this chunk was waiting
        if (!this.isCurrent(child) || output.length === 0) return
        if (this.state.status === 'clean' && this.state.muted) return
        this.emit('Audio', output)
      })
    })

    // Writing to a process that just died fails with EPIPE, which would
    // otherwise be thrown as an unhandled error. The exit is handled below.
    child.stdin.on('error', (error) => {
      if (this.isCurrent(child)) this.log('Piper stdin error:', error.message)
    })

    const errors: string[] = []
    child.stderr.on('data', (chunk: Buffer) => errors.push(chunk.toString()))

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (!this.isCurrent(child)) return
      console.error(`[PiperTTS] Cannot run "${binary}":`, error.message)
      this.clearQuietTimer()
      if (error.code && FATAL_SPAWN_ERRORS.includes(error.code)) {
        // Every sentence of the call would fail the same way, so it is said
        // once and nothing is started again
        this.state = { status: 'failed' }
        this.emit('Failed', [])
      } else {
        this.state = { status: 'none' }
      }
    })

    child.on('exit', (code) => {
      // A process we replaced ourselves exits on purpose
      if (!this.isCurrent(child)) return
      this.clearQuietTimer()
      this.state = { status: 'none' }
      if (code === 0) return
      console.error(
        `[PiperTTS] Piper exited with code ${code}`,
        errors.join('')
      )
      this.emit('Failed', [])
    })

    return child
  }

  private isCurrent(child: ChildProcessWithoutNullStreams): boolean {
    const { state } = this
    return (
      (state.status === 'clean' || state.status === 'dirty') &&
      state.child === child
    )
  }

  /** The process was given text, it holds audio back until it went quiet. */
  private setDirty(child: ChildProcessWithoutNullStreams) {
    this.clearQuietTimer()
    this.state = { status: 'dirty', child }
  }

  /** Audio came out: the process is clean once it stays quiet a moment. */
  private handleOutput(child: ChildProcessWithoutNullStreams) {
    const { state } = this
    if (state.status !== 'dirty' || state.child !== child) return
    if (state.quietTimer) clearTimeout(state.quietTimer)
    state.quietTimer = setTimeout(() => {
      if (this.state === state) this.state = { status: 'clean', child }
    }, QUIET_DELAY)
  }

  private clearQuietTimer() {
    if (this.state.status === 'dirty' && this.state.quietTimer) {
      clearTimeout(this.state.quietTimer)
    }
  }

  private killChild() {
    const { state } = this
    if (state.status !== 'clean' && state.status !== 'dirty') return
    this.clearQuietTimer()
    this.state = { status: 'none' }
    state.child.stdout.removeAllListeners()
    state.child.kill('SIGKILL')
  }

  private getArguments(): string[] {
    const { options } = this
    const args = ['--model', options.modelPath, '--output_raw']

    if (options.configPath) args.push('--config', options.configPath)
    if (options.speaker !== undefined) {
      args.push('--speaker', String(options.speaker))
    }
    if (options.lengthScale !== undefined) {
      args.push('--length_scale', String(options.lengthScale))
    }
    if (options.noiseScale !== undefined) {
      args.push('--noise_scale', String(options.noiseScale))
    }
    if (options.noiseWidth !== undefined) {
      args.push('--noise_w', String(options.noiseWidth))
    }
    if (options.sentenceSilence !== undefined) {
      args.push('--sentence_silence', String(options.sentenceSilence))
    }
    if (options.volume !== undefined) {
      args.push('--volume', String(options.volume))
    }

    return args
  }
}

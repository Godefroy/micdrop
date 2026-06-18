/**
 * Streaming linear-interpolation resampler for PCM16 mono audio.
 *
 * Works in both directions (up or downsampling). It is stateful: it handles
 * arbitrary byte boundaries (a network chunk can split a 16-bit sample) and
 * keeps the fractional sample position continuous across chunks, so feeding a
 * stream chunk by chunk yields the same result as resampling it in one go.
 *
 * Used by OpenaiSTT (16kHz -> 24kHz, GA Realtime API requires >= 24kHz) and
 * OpenaiTTS (24kHz pcm output -> 16kHz expected by the Micdrop client).
 */
export class Pcm16Resampler {
  private readonly step: number
  private leftover: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  private pos = 0 // Fractional position into the first sample of the buffer

  constructor(inRate: number, outRate: number) {
    this.step = inRate / outRate
  }

  // Reset to the initial state, to resample a new independent stream
  // (e.g. resending buffered audio after a reconnection).
  reset() {
    this.leftover = Buffer.alloc(0)
    this.pos = 0
  }

  process(chunk: Buffer): Buffer {
    const buf = this.leftover.length
      ? Buffer.concat([this.leftover, chunk])
      : chunk
    const samples = Math.floor(buf.length / 2)

    // Need at least 2 samples to interpolate
    if (samples < 2) {
      this.leftover = buf
      return Buffer.alloc(0)
    }

    const out: number[] = []
    let p = this.pos
    while (Math.floor(p) + 1 < samples) {
      const i = Math.floor(p)
      const frac = p - i
      const s0 = buf.readInt16LE(i * 2)
      const s1 = buf.readInt16LE((i + 1) * 2)
      out.push(Math.round(s0 + (s1 - s0) * frac))
      p += this.step
    }

    // Keep the last still-needed sample (and any trailing odd byte) for the
    // next chunk, and carry the fractional position relative to it.
    const consumed = Math.floor(p)
    this.pos = p - consumed
    this.leftover = buf.subarray(consumed * 2)

    const result = Buffer.alloc(out.length * 2)
    for (let k = 0; k < out.length; k++) {
      result.writeInt16LE(out[k], k * 2)
    }
    return result
  }
}

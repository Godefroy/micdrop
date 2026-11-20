/**
 * Cuts a stream of PCM16 bytes on sample boundaries.
 *
 * A network or process chunk can end in the middle of a 16-bit sample, and the
 * client reads each chunk as whole samples. The odd byte is held back and put
 * in front of the next chunk, so every chunk returned holds whole samples.
 */
export class Pcm16Aligner {
  private leftover?: Buffer

  process(chunk: Buffer): Buffer {
    const buf = this.leftover ? Buffer.concat([this.leftover, chunk]) : chunk
    const length = buf.length - (buf.length % 2)
    this.leftover = length < buf.length ? buf.subarray(length) : undefined
    return buf.subarray(0, length)
  }

  /** Forgets the held byte, to start an independent stream */
  reset() {
    this.leftover = undefined
  }
}

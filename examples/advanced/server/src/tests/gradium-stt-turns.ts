import * as dotenv from 'dotenv'
dotenv.config({ quiet: true })

import { GradiumSTT } from '@micdrop/gradium'
import { PassThrough } from 'stream'
import WebSocket from 'ws'

// Three utterances in a row, streamed like a microphone, to check that each
// transcript ends with its own last word rather than the next one starting with it:
// npx tsx server/src/tests/gradium-stt-turns.ts [language]
//
// The utterances are spoken by ElevenLabs, with the silence after the last word
// cut off, which is the hardest case for the end of a turn.

const language = process.argv[2] || 'any'

const LINES = [
  'I would like to order a large pizza.',
  'Please deliver it to my office tomorrow.',
  'And add a bottle of lemonade.',
]

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function synthesize(text: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `wss://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID}/stream-input?model_id=eleven_flash_v2_5&output_format=pcm_16000`,
      { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY || '' } }
    )
    const chunks: Buffer[] = []
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString())
      if (message.audio) chunks.push(Buffer.from(message.audio, 'base64'))
      if (message.isFinal) {
        socket.close()
        resolve(Buffer.concat(chunks))
      }
    })
    socket.on('error', reject)
    socket.on('open', () => {
      socket.send(JSON.stringify({ text: ' ' }))
      socket.send(JSON.stringify({ text: text + ' ' }))
      socket.send(JSON.stringify({ text: '' }))
    })
  })
}

/** Cuts the silence after the last word, below -40 dB */
function trimEnd(audio: Buffer) {
  let end = audio.length - 2
  while (end > 0 && Math.abs(audio.readInt16LE(end)) < 328) end -= 2
  return audio.subarray(0, end + 2)
}

async function main() {
  const audios = (await Promise.all(LINES.map(synthesize))).map(trimEnd)
  const stt = new GradiumSTT({
    apiKey: process.env.GRADIUM_API_KEY || '',
    language,
  })

  for (const [i, audio] of audios.entries()) {
    const stream = new PassThrough()
    const transcript = new Promise<string>((resolve) =>
      stt.once('Transcript', resolve)
    )
    stt.transcribe(stream)

    // 20 ms chunks at the pace of a microphone
    for (let offset = 0; offset < audio.length; offset += 640) {
      stream.write(audio.subarray(offset, offset + 640))
      await sleep(20)
    }
    const endedAt = Date.now()
    stream.end()

    console.log(`said:  ${LINES[i]}`)
    console.log(
      `heard: ${await transcript} (${Date.now() - endedAt} ms after the end)`
    )
    await sleep(1500)
  }

  stt.destroy()
  process.exit(0)
}

main()

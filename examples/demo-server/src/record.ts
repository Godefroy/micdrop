import { Logger, MicdropRecorder, MicdropServer } from '@micdrop/server'
import { writeFileSync } from 'fs'
import { join } from 'path'

export function record(server: MicdropServer) {
  const recorder = new MicdropRecorder(server)
  // recorder.logger = new Logger('MicdropRecorder')

  // Save audio messages to a single JSON file at the repo root of demo-server
  const filePath = join(__dirname, '../../demo-client/public/recording.json')
  const audioMessages: object[] = []
  writeFileSync(filePath, JSON.stringify(audioMessages, null, 2))

  recorder.on('AudioMessage', (audioMessage) => {
    const data = {
      messageIndex: audioMessage.messageIndex,
      message: audioMessage.message,
      role: audioMessage.role,
      buffer: audioMessage.buffer.toString('base64'),
      timestamp: new Date().toISOString(),
    }
    audioMessages.push(data)
    writeFileSync(filePath, JSON.stringify(audioMessages, null, 2))
    console.log(
      `Saved audio message: ${audioMessage.role} (${audioMessage.buffer.length} bytes)`
    )
  })

  return recorder
}

# Recording Audio

The `MicdropRecorder` class enables recording of audio messages during voice calls, capturing both user and assistant audio with their corresponding conversation messages.

## Basic Usage

```typescript
import { MicdropServer, MicdropRecorder, Logger } from '@micdrop/server'

const server = new MicdropServer(socket, { agent, stt, tts })

// Create recorder
const recorder = new MicdropRecorder(server)
recorder.logger = new Logger('MicdropRecorder')

// Listen for audio messages
recorder.on('AudioMessage', (audioMessage) => {
  console.log('Audio recorded:', {
    role: audioMessage.role,
    messageIndex: audioMessage.messageIndex,
    bufferSize: audioMessage.buffer.length,
  })
})

// Get all recordings when call ends
recorder.on('Complete', (audioMessages) => {
  console.log(`Call complete with ${audioMessages.length} audio messages`)
})
```

## AudioMessage Structure

Each `AudioMessage` contains:

```typescript
interface AudioMessage {
  buffer: Buffer // Raw audio data
  messageIndex: number // Index in agent.conversation
  message: string // The message content
  role: 'user' | 'assistant' // Speaker role
}
```

## Saving to File

Save audio messages incrementally as they arrive:

```typescript
import { writeFileSync } from 'fs'

const audioMessages: object[] = []

recorder.on('AudioMessage', (audioMessage) => {
  const data = {
    messageIndex: audioMessage.messageIndex,
    message: audioMessage.message,
    role: audioMessage.role,
    buffer: audioMessage.buffer.toString('base64'),
    timestamp: new Date().toISOString(),
  }
  audioMessages.push(data)
  writeFileSync('recording.json', JSON.stringify(audioMessages, null, 2))
})
```

## Recorder Events

The recorder emits the following events:

| Event          | Payload          | Description                                      |
| -------------- | ---------------- | ------------------------------------------------ |
| `AudioMessage` | `AudioMessage`   | Emitted when an audio message is complete        |
| `Complete`     | `AudioMessage[]` | Emitted when the call ends with all recordings   |

## Server Events

`MicdropRecorder` relies on events from `MicdropServer`:

| Event            | Payload              | Description                  |
| ---------------- | -------------------- | ---------------------------- |
| `UserAudio`      | `Buffer`             | Raw audio chunk from user    |
| `AssistantAudio` | `Buffer`             | Raw audio chunk from TTS     |
| `End`            | `MicdropCallSummary` | Call ended                   |

You can also listen to these events directly on `MicdropServer`:

```typescript
server.on('UserAudio', (chunk) => {
  console.log('User audio chunk:', chunk.length, 'bytes')
})

server.on('AssistantAudio', (chunk) => {
  console.log('Assistant audio chunk:', chunk.length, 'bytes')
})

server.on('End', (summary) => {
  console.log('Call ended:', summary)
})
```

## Cleanup

Call `destroy()` to clean up listeners when done:

```typescript
recorder.destroy()
```

## Technical Notes

- User audio chunks arrive **before** the user message is added to the conversation
- The recorder buffers chunks and associates them with messages when available
- Assistant audio is finalized when the next user speech begins or when the call ends
- Audio is stored as raw PCM buffers (16kHz, 16-bit, mono)

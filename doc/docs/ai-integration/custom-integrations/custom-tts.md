# Text-to-Speech (TTS)

The `TTS` class is the core abstraction for **text-to-speech** functionality in Micdrop. It provides a standardized interface for integrating various text-to-speech providers into real-time voice conversations.

## Available Implementations

- [ElevenLabsTTS](https://github.com/Godefroy/micdrop/blob/main/packages/elevenlabs/src/ElevenLabsTTS.ts) from [@micdrop/elevenlabs](../provided-integrations/elevenlabs)
- [CartesiaTTS](https://github.com/Godefroy/micdrop/blob/main/packages/cartesia/src/CartesiaTTS.ts) from [@micdrop/cartesia](../provided-integrations/cartesia)
- [MockTTS](https://github.com/Godefroy/micdrop/blob/main/packages/server/src/tts/MockTTS.ts) for testing

For automatic failover between multiple TTS providers, see [FallbackTTS](../fallback-strategies/tts-fallback).

## Overview

The `TTS` class is an abstract base class that manages:

- Real-time text stream processing
- Audio stream generation and output
- Cancellation and cleanup mechanisms
- Integration with logging systems
- Audio format conversion and optimization

```typescript
export abstract class TTS extends EventEmitter<TTSEvents> {
  public logger?: Logger

  // Convert text stream to audio (emits Audio event)
  abstract speak(textStream: Readable): void

  // Cancel current speech generation
  abstract cancel(): void

  // Protected logging method
  protected log(...message: any[]): void

  // Cleanup
  destroy(): void
}
```

## Events

The TTS class emits the following events:

### Audio

Emitted when an audio chunk is ready to be sent to the client.

```typescript
tts.on('Audio', (audioChunk: Buffer) => {
  console.log('Received audio chunk:', audioChunk.length, 'bytes')
  // Send to client
})
```

### Failed

Emitted when the TTS service fails after exhausting all retries. This event provides the buffered text chunks that were pending synthesis.

```typescript
tts.on('Failed', (textChunks: string[]) => {
  console.error('TTS failed with', textChunks.length, 'pending text chunks')
  // Handle failure (e.g., notify user, fallback to another TTS)
})
```

## Abstract Methods

### `speak(textStream: Readable): Readable`

Converts a streaming text input into a streaming audio output.

**Implementation Requirements:**

- Accept a `Readable` stream containing text chunks
- Return a `Readable` stream that outputs audio chunks
- Handle real-time streaming for optimal latency
- Support cancellation via the `cancel()` method
- Process text incrementally as it arrives
- Handle text stream errors gracefully

### `cancel(): void`

Cancels the current speech generation process. Should:

- Abort any ongoing API requests
- Stop audio stream generation
- Clean up resources (WebSocket connections, timers, etc.)
- End audio output stream gracefully

## Public Methods

### `destroy()`

Cleans up the TTS instance:

- Calls `cancel()` to stop ongoing operations
- Logs destruction event
- Performs final cleanup

## Debug Logging

Enable detailed logging for development:

```typescript
// Enable debug logging
tts.logger = new Logger('CustomTTS')
```

## Custom TTS Implementation

### Creating a WebSocket-based Streaming TTS

For real-time streaming text-to-speech services:

```typescript
import { TTS } from '@micdrop/server'
import { PassThrough, Readable } from 'stream'
import WebSocket from 'ws'

interface CustomStreamingTTSOptions {
  apiKey: string
  voiceId: string
  language?: string
}

export class CustomStreamingTTS extends TTS {
  private socket?: WebSocket
  private initPromise: Promise<void>
  private audioStream?: PassThrough
  private reconnectTimeout?: NodeJS.Timeout
  private sessionId = 0

  constructor(private readonly options: CustomStreamingTTSOptions) {
    super()

    // Initialize WebSocket connection
    this.initPromise = this.initConnection()
  }

  speak(textStream: Readable): Readable {
    this.sessionId++
    const currentSession = this.sessionId

    // Reset streams for new speech
    this.stopCurrentStreams()
    this.audioStream = new PassThrough()

    // Process incoming text chunks
    textStream.on('data', async (chunk) => {
      if (currentSession !== this.sessionId) return // Session changed

      await this.initPromise
      const text = chunk.toString('utf-8').trim()

      if (text) {
        this.sendTextChunk(text, currentSession)
      }
    })

    textStream.on('error', (error) => {
      this.log('Text stream error:', error)
      this.audioStream?.destroy(error)
    })

    textStream.on('end', async () => {
      if (currentSession !== this.sessionId) return

      await this.initPromise
      this.finalizeSession(currentSession)
    })

    // Return PCM audio stream
    return this.audioStream
  }

  private async initConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = new WebSocket(
        `wss://api.example.com/v1/tts/stream?api_key=${this.options.apiKey}`
      )

      this.socket.addEventListener('open', () => {
        this.log('TTS WebSocket connected')
        this.sendConfiguration()
        resolve()
      })

      this.socket.addEventListener('message', (event) => {
        this.handleWebSocketMessage(event.data)
      })

      this.socket.addEventListener('error', (error) => {
        this.log('WebSocket error:', error)
        reject(error)
      })

      this.socket.addEventListener('close', ({ code, reason }) => {
        this.log(`WebSocket closed: ${code} ${reason}`)
        if (code !== 1000) {
          this.reconnect()
        }
      })
    })
  }

  private sendConfiguration() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return

    const config = {
      type: 'config',
      voice_id: this.options.voiceId,
      language: this.options.language || 'en',
      output_format: {
        encoding: 'pcm_s16le',
        sample_rate: 16000,
        channels: 1,
      },
    }

    this.socket.send(JSON.stringify(config))
    this.log('Sent TTS configuration')
  }

  private sendTextChunk(text: string, sessionId: number) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return

    const message = {
      type: 'text',
      text,
      session_id: sessionId,
      stream: true,
    }

    this.socket.send(JSON.stringify(message))
    this.log(`Sent text chunk: "${text}"`)
  }

  private finalizeSession(sessionId: number) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return

    const message = {
      type: 'finalize',
      session_id: sessionId,
    }

    this.socket.send(JSON.stringify(message))
    this.log('Finalized TTS session')
  }

  private handleWebSocketMessage(data: any) {
    try {
      const message = JSON.parse(data.toString())

      switch (message.type) {
        case 'audio':
          if (message.session_id === this.sessionId) {
            const audioChunk = Buffer.from(message.data, 'base64')
            this.log(`Received audio chunk: ${audioChunk.length} bytes`)
            this.audioStream?.write(audioChunk)
          }
          break

        case 'audio_end':
          if (message.session_id === this.sessionId) {
            this.log('Audio generation completed')
            this.audioStream?.end()
          }
          break

        case 'error':
          this.log('TTS error:', message.error)
          this.audioStream?.destroy(new Error(message.error))
          break

        default:
          this.log('Unknown message type:', message.type)
      }
    } catch (error) {
      this.log('Error parsing WebSocket message:', error)
    }
  }

  private stopCurrentStreams() {
    this.audioStream?.end()
    this.audioStream = undefined
  }

  private reconnect() {
    this.log('Attempting to reconnect...')
    this.reconnectTimeout = setTimeout(() => {
      this.initPromise = this.initConnection().catch(() => this.reconnect())
    }, 1000)
  }

  cancel(): void {
    this.log('Cancelling TTS operation')
    this.sessionId++ // Invalidate current session
    this.stopCurrentStreams()
  }

  destroy(): void {
    super.destroy()

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
    }

    if (this.socket) {
      this.socket.close(1000, 'Client disconnect')
    }
  }
}
```

### Using CustomStreamingTTS with MicdropServer

```typescript
// Create custom TTS
const tts = new CustomStreamingTTS({
  apiKey: process.env.CUSTOM_TTS_API_KEY || '',
  voiceId: process.env.CUSTOM_VOICE_ID || '',
  language: 'en',
})

// Add logging
tts.logger = new Logger('CustomTTS')

// Create server with custom TTS
const server = new MicdropServer(socket, {
  tts,
  // ... other options
})
```

### Creating a Fetch-based TTS Implementation

For services that process complete text before generating audio:

```typescript
import { TTS } from '@micdrop/server'
import { PassThrough, Readable } from 'stream'
import { text } from 'stream/consumers'

interface CustomFetchTTSOptions {
  apiKey: string
  voiceId: string
  model?: string
  language?: string
}

export class CustomFetchTTS extends TTS {
  private currentRequest?: AbortController

  constructor(private readonly options: CustomFetchTTSOptions) {
    super()
  }

  speak(textStream: Readable): Readable {
    const audioStream = new PassThrough()

    this.generateSpeech(textStream, audioStream)

    return audioStream
  }

  private async generateSpeech(textStream: Readable, audioStream: PassThrough) {
    try {
      // Collect all text first
      this.log('Collecting text content...')
      const textContent = await text(textStream)

      if (!textContent.trim()) {
        audioStream.end()
        return
      }

      this.log(`Generating speech for: "${textContent}"`)

      // Create abort controller for cancellation
      this.currentRequest = new AbortController()

      // Make API request
      const response = await fetch('https://api.example.com/v1/tts/generate', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: textContent,
          voice_id: this.options.voiceId,
          model: this.options.model || 'neural-v1',
          language: this.options.language || 'en',
          output_format: 'pcm_s16le', // 16-bit signed little-endian PCM at 16kHz
        }),
        signal: this.currentRequest.signal,
      })

      if (!response.ok) {
        throw new Error(
          `TTS API error: ${response.status} ${response.statusText}`
        )
      }

      // Check if we have streaming response
      if (response.body) {
        this.log('Streaming audio response...')
        await this.streamAudioResponse(response.body, audioStream)
      } else {
        throw new Error('No audio data in response')
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          this.log('TTS request was cancelled')
        } else {
          this.log('TTS generation failed:', error.message)
          audioStream.destroy(error)
        }
      }
    } finally {
      this.currentRequest = undefined
    }
  }

  private async streamAudioResponse(
    responseBody: ReadableStream<Uint8Array>,
    audioStream: PassThrough
  ) {
    const reader = responseBody.getReader()

    try {
      while (true) {
        const { done, value } = await reader.read()

        if (done) {
          this.log('Audio stream completed')
          break
        }

        if (value) {
          // Convert to Buffer and write to stream
          const audioChunk = Buffer.from(value)
          this.log(`Received audio chunk: ${audioChunk.length} bytes`)
          audioStream.write(audioChunk)
        }
      }
    } finally {
      reader.releaseLock()
      audioStream.end()
    }
  }

  cancel(): void {
    this.log('Cancelling TTS request')
    this.currentRequest?.abort()
  }
}
```

### Using CustomFetchTTS with MicdropServer

```typescript
// Create and configure custom TTS
const tts = new CustomFetchTTS({
  apiKey: process.env.CUSTOM_TTS_API_KEY || '',
  voiceId: process.env.CUSTOM_VOICE_ID || '',
  language: 'en',
})

// Add logging
tts.logger = new Logger('CustomTTS')

// Create server with custom TTS
const server = new MicdropServer(socket, {
  tts,
  // ... other options
})
```

### Simple Echo TTS Example

For testing and development:

```typescript
import { TTS } from '@micdrop/server'
import { PassThrough, Readable } from 'stream'
import { text } from 'stream/consumers'

export class EchoTTS extends TTS {
  private sampleAudio: Buffer

  constructor(sampleAudioPath: string) {
    super()
    // Load a sample audio file to use as "speech"
    this.sampleAudio = require('fs').readFileSync(sampleAudioPath)
  }

  speak(textStream: Readable): Readable {
    const audioStream = new PassThrough()
    this.processText(textStream, audioStream)
    return audioStream
  }

  private async processText(textStream: Readable, audioStream: PassThrough) {
    try {
      // Wait for first text chunk
      textStream.once('data', () => {
        this.log('Echoing sample audio for any text input')
        audioStream.write(this.sampleAudio)
      })

      textStream.on('end', () => {
        audioStream.end()
      })

      textStream.on('error', (error) => {
        audioStream.destroy(error)
      })
    } catch (error) {
      audioStream.destroy(error as Error)
    }
  }

  cancel(): void {
    // Nothing to cancel for this simple implementation
    this.log('Echo TTS cancelled')
  }
}
```

### Using EchoTTS with MicdropServer

```typescript
// Create and configure custom TTS
const echoTTS = new EchoTTS('/path/to/sample-audio.wav')
echoTTS.logger = new Logger('EchoTTS')

// Test the TTS
const textStream = new PassThrough()
const audioStream = echoTTS.speak(textStream)

textStream.write('Hello, world!')
textStream.end()

audioStream.on('data', (chunk) => {
  console.log(`Audio chunk received: ${chunk.length} bytes`)
})

audioStream.on('end', () => {
  console.log('Audio generation completed')
  echoTTS.destroy()
})
```

## Audio Format Considerations

### Output Format

TTS implementations should output audio in PCM format (specifically `pcm_s16le` - 16-bit signed little-endian PCM) for optimal compatibility and performance with Micdrop.

The recommended audio specifications are:

- **Format**: PCM (pcm_s16le)
- **Sample Rate**: 16000 Hz
- **Channels**: 1 (mono)
- **Bit Depth**: 16-bit signed integers

### Why PCM?

PCM format is recommended because:

- **Low latency**: No encoding/decoding overhead
- **Universal compatibility**: Supported by all audio systems
- **Real-time streaming**: Optimal for live conversation scenarios
- **Simplicity**: Direct audio data without compression artifacts

### Streaming Considerations

For optimal real-time performance:

- **Chunk Size**: Balance between latency and efficiency (typically 1-4KB chunks)
- **Buffering**: Minimize buffering to reduce latency
- **Error Handling**: Gracefully handle network interruptions
- **Cancellation**: Support immediate cancellation for natural conversation flow

## Error Handling

Robust TTS implementations should handle:

```typescript
// Network errors
textStream.on('error', (error) => {
  this.log('Text stream error:', error)
  audioStream.end()
})

// API errors
if (!response.ok) {
  throw new Error(`TTS API error: ${response.status}`)
}

// Cancellation
if (this.abortController.signal.aborted) {
  throw new Error('Request was cancelled')
}
```

# Speech-to-Text (STT)

The `STT` class is the core abstraction for speech-to-text functionality in Micdrop. It provides a standardized interface for integrating various speech-to-text providers into real-time voice conversations.

## Available Implementations

- [OpenaiSTT](https://github.com/Godefroy/micdrop/blob/main/packages/openai/src/OpenaiSTT.ts) from [@micdrop/openai](../provided-integrations/openai)
- [GladiaSTT](https://github.com/Godefroy/micdrop/blob/main/packages/gladia/src/GladiaSTT.ts) from [@micdrop/gladia](../provided-integrations/gladia)
- [MockSTT](https://github.com/Godefroy/micdrop/blob/main/packages/server/src/stt/MockSTT.ts) for testing

For automatic failover between multiple STT providers, see [FallbackSTT](../fallback-strategies/stt-fallback).

## Overview

The `STT` class is an abstract base class that extends `EventEmitter` and manages:

- Real-time audio stream processing
- Automatic audio format detection
- Event emission for transcription results
- Integration with logging systems
- Resource cleanup and cancellation

```typescript
export abstract class STT extends EventEmitter<STTEvents> {
  public logger?: Logger

  // Transcribe audio stream to text (emits Transcript event)
  abstract transcribe(audioStream: Readable): void

  // Cleanup
  destroy(): void
}
```

## Events

The STT class emits the following events:

### Transcript

Emitted when a transcription is ready.

```typescript
stt.on('Transcript', (text: string) => {
  console.log('Transcript:', text)
})
```

### Failed

Emitted when the STT service fails after exhausting all retries. This event provides the buffered audio chunks that were pending transcription.

```typescript
stt.on('Failed', (audioChunks: Buffer[]) => {
  console.error('STT failed with', audioChunks.length, 'pending audio chunks')
  // Handle failure (e.g., notify user, fallback to another STT)
})
```

## Debug Logging

Enable detailed logging for development:

```typescript
// Enable debug logging
stt.logger = new Logger('CustomSTT')
```

## Custom STT Implementation

### Creating a Real-time STT Implementation

For services that support real-time streaming transcription:

```typescript
import { STT } from '@micdrop/server'
import { Readable } from 'stream'
import WebSocket from 'ws'

export class CustomRealtimeSTT extends STT {
  private socket?: WebSocket
  private reconnectTimeout?: NodeJS.Timeout
  private keepAliveInterval?: NodeJS.Timeout

  constructor(
    private options: {
      apiKey: string
      language?: string
    }
  ) {
    super()
  }

  async transcribe(audioStream: Readable) {
    // Initialize WebSocket connection
    await this.initConnection()

    // Process incoming audio chunks
    audioStream.on('data', (chunk: Buffer) => {
      this.processAudioChunk(chunk)
    })

    audioStream.on('end', () => {
      this.finalizeStream()
    })

    audioStream.on('error', (error) => {
      this.log('Audio stream error:', error)
      this.emit('error', error)
    })
  }

  private async initConnection() {
    if (this.socket) return
    const wsUrl = `wss://api.example.com/v1/stream?key=${this.options.apiKey}`

    this.socket = new WebSocket(wsUrl)

    this.socket.addEventListener('open', () => {
      this.log('Connected to STT service')
      this.sendConfiguration()
      this.startKeepAlive()
    })

    this.socket.addEventListener('message', (event) => {
      this.handleMessage(JSON.parse(event.data))
    })

    this.socket.addEventListener('error', (error) => {
      this.log('WebSocket error:', error)
      this.emit('error', error)
    })

    this.socket.addEventListener('close', ({ code, reason }) => {
      this.log(`Connection closed: ${code} ${reason}`)
      if (code !== 1000) {
        this.reconnect()
      }
    })
  }

  private sendConfiguration() {
    if (!this.socket) return

    const config = {
      type: 'config',
      language: this.options.language || 'en',
      encoding: 'pcm',
      interim_results: true,
    }

    this.socket.send(JSON.stringify(config))
  }

  private processAudioChunk(chunk: Buffer) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(chunk)
    }
  }

  private handleMessage(message: any) {
    switch (message.type) {
      case 'transcript':
        if (message.is_final && message.text) {
          this.log(`Final transcript: "${message.text}"`)
          this.emit('Transcript', message.text)
        }
        break

      case 'error':
        this.log('Service error:', message.error)
        this.emit('error', new Error(message.error))
        break

      case 'ping':
        this.socket?.send(JSON.stringify({ type: 'pong' }))
        break
    }
  }

  private finalizeStream() {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'end_stream' }))
    }
  }

  private startKeepAlive() {
    this.keepAliveInterval = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: 'ping' }))
      }
    }, 30000)
  }

  private reconnect() {
    this.log('Attempting reconnection...')
    this.reconnectTimeout = setTimeout(() => {
      this.initConnection().catch(() => this.reconnect())
    }, 1000)
  }

  destroy() {
    super.destroy()

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
    }

    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval)
    }

    if (this.socket) {
      this.socket.close(1000, 'Client disconnect')
    }
  }
}
```

### Using CustomRealtimeSTT with MicdropServer

```typescript
// Create custom STT
const stt = new CustomRealtimeSTT({
  apiKey: process.env.CUSTOM_STT_API_KEY || '',
  language: 'en',
})

// Add logging
stt.logger = new Logger('CustomSTT')

// Create server with custom STT
const server = new MicdropServer(socket, {
  stt,
  // ... other options
})
```

# Voice Activity Detection (VAD)

Micdrop uses a VAD (Voice Activity Detection) to detect speech and silence and send chunks of audio to the server only when speech is detected.

## Supported VAD Types

Micdrop supports the following VADs by name:

- `'volume'`: Volume-based VAD (default)
- `'silero'`: AI-based VAD using Silero

You can also pass instances of these VADs, or combine them in an array. See below for details.

> **Note:** Only `'volume'` and `'silero'` are supported as string names. Custom VADs must be passed as instances.

## Quick Start

Configure VAD when starting a call:

```typescript
import { Micdrop } from '@micdrop/client'

// Use volume-based detection (default)
await Micdrop.start({
  url: 'ws://localhost:8081',
  vad: 'volume',
})

// Use AI-based detection for better accuracy
await Micdrop.start({
  url: 'ws://localhost:8081',
  vad: 'silero',
})

// Combine multiple VADs for best results
await Micdrop.start({
  url: 'ws://localhost:8081',
  vad: ['volume', 'silero'],
})
```

Or when starting the microphone (before starting the call):

```typescript
Micdrop.startMic({ vad: 'volume' })
```

## Volume VAD: Speech detection based on volume

By default, `MicdropClient` uses `VolumeVAD` for speech detection. You can use it explicitly when starting Micdrop:

```typescript
Micdrop.start({ vad: 'volume' })
```

or when starting the microphone (before starting the call):

```typescript
Micdrop.startMic({ vad: 'volume' })
```

It is inspired by [hark](https://github.com/otalk/hark) and triggers speech detection events based on volume changes.

You can also pass an instance of `VolumeVAD` to `MicdropClient`:

```typescript
const vad = new VolumeVAD({
  history: 5, // Number of frames to consider for volume calculation
  threshold: -55, // Threshold in decibels for speech detection
})
Micdrop.start({ vad })
```

- **Default options:** `{ history: 5, threshold: -55 }`
- **Persistence:** Options are saved to `localStorage` and restored automatically.

**When to use Volume VAD:**

- ✅ Low latency requirements
- ✅ Quiet environments
- ✅ Clear speech patterns
- ❌ Noisy environments
- ❌ Soft-spoken users

## Silero VAD: Human speech detection with AI

To use `SileroVAD` for speech detection:

```typescript
Micdrop.start({ vad: 'silero' })
```

It is based on [@ricky0123/vad-web](https://github.com/ricky0123/vad) which runs a [Silero VAD](https://github.com/snakers4/silero-vad) model in the browser using [ONNX Runtime Web](https://github.com/microsoft/onnxruntime/tree/main/js/web).

It is more accurate than `VolumeVAD` and works better with low voice.

You can also pass an instance of `SileroVAD` to `MicdropClient`:

```typescript
const vad = new SileroVAD({
  positiveSpeechThreshold: 0.18, // Threshold for positive speech detection
  negativeSpeechThreshold: 0.11, // Threshold for negative speech detection
  minSpeechFrames: 8, // Minimum number of frames to consider for speech detection
  redemptionFrames: 20, // Number of frames to consider for silence detection
})
Micdrop.start({ vad })
```

- **Default options:** `{ positiveSpeechThreshold: 0.18, negativeSpeechThreshold: 0.11, minSpeechFrames: 8, redemptionFrames: 20 }`
- **Persistence:** Options are saved to `localStorage` and restored automatically.

**When to use Silero VAD:**

- ✅ Noisy environments
- ✅ Soft-spoken users
- ✅ Multiple speakers
- ✅ Background music/TV
- ❌ Extremely low latency needs (adds ~50ms processing)

## Multiple VAD: Combine multiple VADs

Combining multiple VADs is useful to get more accurate speech detection:

- Volume to ignore low voice
- Silero to detect human speech

You can combine multiple VADs by passing an array of VAD names:

```typescript
Micdrop.start({ vad: ['volume', 'silero'] })
```

Or with instances:

```typescript
const vad = [new VolumeVAD(), new SileroVAD()]
Micdrop.start({ vad })
```

Or mix names and instances:

```typescript
await Micdrop.start({
  vad: ['volume', new SileroVAD({ positiveSpeechThreshold: 0.15 })],
})
```

**How it works:**

- `StartSpeaking` is emitted when any VAD detects possible speech.
- `ConfirmSpeaking` is emitted only when _all_ VADs confirm speech.
- `StopSpeaking` is emitted when _all_ VADs detect silence.
- `CancelSpeaking` is emitted if all VADs agree speech was a false positive.

This approach reduces false positives while maintaining quick response times.

## VAD Events

VADs emit the following events:

- `StartSpeaking`: Possible speech detected (not yet confirmed)
- `ConfirmSpeaking`: Speech confirmed
- `CancelSpeaking`: Speech start was a false positive (noise, etc.)
- `StopSpeaking`: Speech ended
- `ChangeStatus`: Status changed (`Silence`, `MaybeSpeaking`, `Speaking`)

Monitor VAD activity in your application:

```typescript
Micdrop.vad.on('StartSpeaking', () => {
  console.log('🎤 Possible speech detected...')
  showListeningIndicator()
})

Micdrop.vad.on('ConfirmSpeaking', () => {
  console.log('✅ Speech confirmed - recording')
  highlightMicrophoneButton()
})

Micdrop.vad.on('StopSpeaking', () => {
  console.log('🔇 Speech ended')
  resetMicrophoneButton()
})

Micdrop.vad.on('CancelSpeaking', () => {
  console.log('❌ False positive - not speech')
  hideListeningIndicator()
})

Micdrop.vad.on('ChangeStatus', (status) => {
  console.log('VAD status:', status) // 'Silence', 'MaybeSpeaking', 'Speaking'
})
```

## Custom VAD

You can also pass your own VAD implementation:

```typescript
Micdrop.start({ vad: new MyCustomVAD() })
```

See [VolumeVAD](https://github.com/Godefroy/micdrop/blob/main/packages/client/src/audio/vad/VolumeVAD.ts) as an example.

## VAD Delay

All VADs have a `delay` property (default: 100ms) that controls the interval for speech detection checks. You can adjust this in custom VADs if needed.

## Tuning VAD Performance

### Volume VAD Tuning

Adjust sensitivity based on environment:

```typescript
// Quiet environment - more sensitive
const quietVad = new VolumeVAD({
  threshold: -65, // Lower threshold for quiet voices
  history: 3, // Faster response
})

// Noisy environment - less sensitive
const noisyVad = new VolumeVAD({
  threshold: -45, // Higher threshold to ignore noise
  history: 8, // More frames for stability
})
```

### Silero VAD Tuning

Fine-tune AI detection:

```typescript
// More sensitive - catches quiet speech
const sensitiveVad = new SileroVAD({
  positiveSpeechThreshold: 0.15, // Lower threshold
  minSpeechFrames: 6, // Faster confirmation
})

// More conservative - reduces false positives
const conservativeVad = new SileroVAD({
  positiveSpeechThreshold: 0.22, // Higher threshold
  minSpeechFrames: 12, // More confirmation needed
  redemptionFrames: 30, // Longer silence confirmation
})
```

## Dynamic VAD Configuration

You can update VAD settings in real-time without restarting:

```typescript
// Update Volume VAD settings
const volumeVad = Micdrop.vad as VolumeVAD
volumeVad.setOptions({ threshold: -45 })

// Update Silero VAD settings
const sileroVad = Micdrop.vad as SileroVAD
sileroVad.setOptions({ positiveSpeechThreshold: 0.15 })

// Reset to default options
volumeVad.resetOptions()
sileroVad.resetOptions()
```

## Persistent Settings

Both VolumeVAD and SileroVAD settings are automatically saved to localStorage and restored when loading with their names (`'volume'` or `'silero'`) and not instances.

## React VAD Settings UI

See a complete React component for VAD configuration based on the demo client: [VADSettings](https://github.com/Godefroy/micdrop/blob/main/examples/demo-client/src/components/VADSettings.tsx)

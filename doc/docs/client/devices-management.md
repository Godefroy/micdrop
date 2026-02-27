# Device Management

Select and manage microphone and speaker devices for optimal audio quality and user preference.

## Quick Start

Access available devices and change them using MicdropClient methods:

```typescript
import { Micdrop } from '@micdrop/client'

// Get available devices
console.log('Microphones:', Micdrop.micDevices)
console.log('Speakers:', Micdrop.speakerDevices)

// Change devices
await Micdrop.changeMicDevice('mic-device-id')
await Micdrop.changeSpeakerDevice('speaker-device-id')
```

## Device Listing

### Get Available Microphones

```typescript
// Access microphone devices
const micDevices = Micdrop.micDevices

micDevices.forEach((device) => {
  console.log('Mic:', device.label || 'Unknown Device')
  console.log('ID:', device.deviceId)
  console.log('Group:', device.groupId)
})

// Current microphone device
console.log('Current mic:', Micdrop.micDeviceId)
```

### Get Available Speakers

```typescript
// Access speaker devices
const speakerDevices = Micdrop.speakerDevices

speakerDevices.forEach((device) => {
  console.log('Speaker:', device.label || 'Unknown Device')
  console.log('ID:', device.deviceId)
  console.log('Group:', device.groupId)
})

// Current speaker device
console.log('Current speaker:', Micdrop.speakerDeviceId)
```

## Device Selection

### Change Microphone

Switch to a different microphone device:

```typescript
// Change microphone by device ID
const newMicId = Micdrop.micDevices[1].deviceId
await Micdrop.changeMicDevice(newMicId)
```

### Change Speaker

Switch to a different speaker/headphone device:

```typescript
// Change speaker by device ID
const newSpeakerId = Micdrop.speakerDevices[1].deviceId
await Micdrop.changeSpeakerDevice(newSpeakerId)
```

### Device Persistence

Selected devices are automatically persisted in localStorage.

## React Device Component

```tsx
import { useState } from 'react'
import { Micdrop } from '@micdrop/client'
import { useMicdropState } from '@micdrop/react'

function DeviceSettings() {
  const state = useMicdropState()
  const [changing, setChanging] = useState(false)

  const changeMic = async (deviceId: string) => {
    setChanging(true)
    try {
      await Micdrop.changeMicDevice(deviceId)
    } finally {
      setChanging(false)
    }
  }

  const changeSpeaker = async (deviceId: string) => {
    setChanging(true)
    try {
      await Micdrop.changeSpeakerDevice(deviceId)
    } finally {
      setChanging(false)
    }
  }

  return (
    <div className="device-settings">
      <div className="device-group">
        <label>Microphone:</label>
        <select
          value={state.micDeviceId || ''}
          onChange={(e) => changeMic(e.target.value)}
          disabled={changing}
        >
          {state.micDevices.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || 'Unknown Microphone'}
            </option>
          ))}
        </select>
      </div>

      <div className="device-group">
        <label>Speaker:</label>
        <select
          value={state.speakerDeviceId || ''}
          onChange={(e) => changeSpeaker(e.target.value)}
          disabled={changing}
        >
          {state.speakerDevices.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || 'Unknown Speaker'}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
```

## Device Testing

### Test Microphone

Monitor microphone input levels to verify the selected device is working correctly.

#### Using Mic Analyzer (Vanilla JavaScript)

```typescript
import { Mic } from '@micdrop/client'

// Listen to microphone volume changes
const onMicVolumeChange = (volume: number) => {
  console.log('Microphone volume:', volume, 'dB')
  // Update your UI with the volume level
  updateMicVolumeIndicator(volume)
}

// Start listening to volume events
Mic.analyser.on('volume', onMicVolumeChange)

// Stop listening (cleanup)
Mic.analyser.off('volume', onMicVolumeChange)
```

#### Using React Hook

```tsx
import { useMicVolume } from '@micdrop/react'

function MicVolumeIndicator() {
  const { micVolume } = useMicVolume()
  const volume = Math.max(0, micVolume + 100) // Convert dB to percentage

  return (
    <div className="mic-volume-container">
      <label>Microphone Level:</label>
      <div
        className="volume-bar"
        style={{
          background: `linear-gradient(
            to right,
            #00bb00,
            #00bb00 ${volume}%,
            #ccc ${volume}%,
            #ccc 100%
          )`,
          width: '100%',
          height: '16px',
          borderRadius: '8px',
          transition: 'all 0.1s',
        }}
      />
      <span>{micVolume.toFixed(1)} dB</span>
    </div>
  )
}
```

This provides real-time visual feedback of microphone input levels, helping users verify their microphone is working and adjust VAD thresholds appropriately.

**Example:** [MicVolume component](https://github.com/Godefroy/micdrop/blob/main/examples/demo-client/src/components/MicVolume.tsx)

**Learn more:** [Mic utility class](./utility-classes/mic)

### Test Speaker

Monitor speaker output levels and test audio playback to verify the selected device is working correctly.

#### Using Speaker Analyzer (Vanilla JavaScript)

```typescript
import { Speaker } from '@micdrop/client'

// Listen to speaker volume changes
const onSpeakerVolumeChange = (volume: number) => {
  console.log('Speaker volume:', volume, 'dB')
  // Update your UI with the volume level
  updateSpeakerVolumeIndicator(volume)
}

// Start listening to volume events
Speaker.analyser.on('volume', onSpeakerVolumeChange)

// Stop listening (cleanup)
Speaker.analyser.off('volume', onSpeakerVolumeChange)
```

#### Using React Hook

```tsx
import { useSpeakerVolume } from '@micdrop/react'

function SpeakerVolumeIndicator() {
  const { speakerVolume } = useSpeakerVolume()
  const volume = Math.max(0, speakerVolume + 100) // Convert dB to percentage

  return (
    <div className="speaker-volume-container">
      <label>Speaker Level:</label>
      <div
        className="volume-bar"
        style={{
          background: `linear-gradient(
            to right,
            #0066cc,
            #0066cc ${volume}%,
            #ccc ${volume}%,
            #ccc 100%
          )`,
          width: '100%',
          height: '16px',
          borderRadius: '8px',
          transition: 'all 0.1s',
        }}
      />
      <span>{speakerVolume.toFixed(1)} dB</span>
    </div>
  )
}
```

**Example:** [SpeakerTestButton component](https://github.com/Godefroy/micdrop/blob/main/examples/demo-client/src/components/SpeakerTestButton.tsx)

**Learn more:** [Speaker utility class](./utility-classes/speaker)

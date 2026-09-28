# 🖐️🎤 Micdrop: Real-Time Voice Conversations with AI

[Micdrop website](https://micdrop.dev) | [Documentation](https://micdrop.dev/docs/client)

Micdrop is a set of open source Typescript packages to build real-time voice conversations with AI agents. It handles all the complexities on the client and server side (microphone, speaker, VAD, network communication, etc) and provides ready-to-use implementations for various AI providers.

# @micdrop/client

The heart of a Micdrop call, with nothing platform specific in it: the protocol, the call state, the voice activity detection, the recording and the playback scheduling.

**You install it through a platform package rather than on its own:**

- [`@micdrop/web`](../web) for a browser
- [`@micdrop/react-native`](../react-native) for iOS and Android

Both re-export everything here, so `import { Micdrop } from '@micdrop/web'` gives you the same objects this package defines.

## What lives here

- `MicdropClient` and the `Micdrop` singleton: the WebSocket protocol, the call state, reconnection, interruption
- `Mic` and `Speaker`: one microphone and one speaker for the app, in front of a pluggable driver
- `MicRecorder`: the reserve of audio, the chunking at 16 kHz, the wiring to the VAD
- `VolumeVAD`, `SileroVAD`, `MultipleVAD`: voice activity detection, the same on every platform
- `Pcm16AudioStream`: gapless playback of the chunks as they arrive
- `VolumeMeter`: the level the VAD and the level meters read

## Writing a platform package

A platform provides two things, and gets everything above for free.

```ts
import { Mic, MicDriver, Speaker, SpeakerDriver } from '@micdrop/client'

class MyMic extends MicDriver {
  // start() captures, then emits Frames with mono float samples
}

class MySpeaker extends SpeakerDriver {
  // play() queues 16 kHz PCM16
}

Mic.setDriver(new MyMic())
Speaker.setDriver(new MySpeaker())
```

`Pcm16AudioStream` does the playback scheduling for you if the platform offers something like Web Audio: give it an `AudioSink`, which is the small slice of it that Micdrop needs, and call its `destroy()` when the driver stops. When the output needs a moment once the microphone opens, as with Firefox and a Bluetooth headset switching to its call profile, call `warmUp(duration)`: the stream plays silence that long and holds the first answer until it is over.

For Silero, provide the inference and the state machine comes from here:

```ts
import { setSileroModelLoader } from '@micdrop/client'

setSileroModelLoader(async () => myModel) // process(frame) => probability
```

## Tests

The whole package runs in Node, from the audio helpers up to a full call against a real `MicdropServer`.

```bash
pnpm --filter @micdrop/client test
```

## Documentation

Read the full [client documentation](https://micdrop.dev/docs/client) on the [website](https://micdrop.dev).

## License

MIT

## Author

Originally developed for [Raconte.ai](https://www.raconte.ai), created and open sourced by [Godefroy de Compreignac](https://github.com/Godefroy)

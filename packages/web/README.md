# 🖐️🎤 Micdrop: Real-Time Voice Conversations with AI

[Micdrop website](https://micdrop.dev) | [Documentation](https://micdrop.dev/docs/client) | [Basic example](../../examples/basic) | [Demo](../../examples/advanced)

Micdrop is a set of open source Typescript packages to build real-time voice conversations with AI agents. It handles all the complexities on the client and server side (microphone, speaker, VAD, network communication, etc) and provides ready-to-use implementations for various AI providers.

# @micdrop/web

The browser side of [Micdrop](https://micdrop.dev). It records and plays with the Web Audio API, and re-exports the whole [`@micdrop/client`](../client) API, so this is the only package a web app installs.

It is framework agnostic, you can use it with React, Vue, Angular or any other framework. See the [advanced demo](../../examples/advanced) for a complete example with React.

For server implementation, see [@micdrop/server](https://micdrop.dev/docs/server).

## Features

- 🎤 Real-time microphone recording and playback
- 🗣️ Voice activity detection, on volume or with the Silero model
- 🔊 Device selection and testing
- 🔌 Full state and events for UI integration
- 🌐 WebSocket audio streaming

## Installation

```bash
npm install @micdrop/web
```

That's it 🎉 No configuration, no asset to copy.

### Vite plugin (strongly recommended)

If your app is built with Vite and uses Silero VAD or turn detection, add the plugin:

```ts
// vite.config.ts
import { micdrop } from '@micdrop/web/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [micdrop()],
})
```

It ships the Silero model with your app and lets Vite emit the ONNX runtime WebAssembly from the version you installed. Without it, both are fetched from jsDelivr and unpkg when a call starts, and a CDN outage, a firewall or an ad blocker keeps voice detection from starting.

## Usage

```ts
import { Micdrop } from '@micdrop/web'

await Micdrop.start({ url: 'wss://example.com/call' })

Micdrop.on('StateChange', (state) => {
  console.log(state.isAssistantSpeaking, state.conversation)
})
```

## Browser specifics

- `import '@micdrop/web/silero'` adds the Silero voice detection, and only then does the ONNX runtime enter your bundle
- `@micdrop/web/vite` bundles the Silero model and the ONNX runtime files with your app, see above
- `setSileroOptions({ model, wasmPath })` serves the Silero model and the ONNX runtime from your own domain with another bundler
- `getSpeakerOutput()` gives the node the assistant voice comes out of, to analyse or process it
- `audioContext` is the shared `AudioContext`

## Documentation

Read the full [client documentation](https://micdrop.dev/docs/client) on the [website](https://micdrop.dev).

## License

MIT

## Author

Originally developed for [Raconte.ai](https://www.raconte.ai), created and open sourced by [Godefroy de Compreignac](https://github.com/Godefroy)

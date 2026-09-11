# 🖐️🎤 Micdrop: Real-Time Voice Conversations with AI

[Micdrop website](https://micdrop.dev) | [Documentation](https://micdrop.dev/docs)

Micdrop is a set of open source Typescript packages to build real-time voice conversations with AI agents. It handles all the complexities on the client and server side (microphone, speaker, VAD, network communication, etc) and provides ready-to-use implementations for various AI providers.

## 📦 Packages

### Core Packages (start here)

- [`@micdrop/web`](./packages/web/README.md) - Browser library handling microphone input, audio playback, and real-time communication
- [`@micdrop/react-native`](./packages/react-native/README.md) - The same call on iOS and Android
- [`@micdrop/server`](./packages/server/README.md) - Server implementation for audio streaming and AI integration orchestration

Both client packages are built on [`@micdrop/client`](./packages/client/README.md), which holds the protocol, the call state and the voice activity detection, and knows nothing about the platform it runs on. You install a platform package, not this one.

### AI Implementations

- [`@micdrop/openai`](./packages/openai/README.md) - OpenAI integration providing LLM agent and speech-to-text capabilities
- [`@micdrop/ai-sdk`](./packages/ai-sdk/README.md) - AI SDK agent compatible with a lot of LLM providers.
- [`@micdrop/elevenlabs`](./packages/elevenlabs/README.md) - ElevenLabs text-to-speech integration with streaming support
- [`@micdrop/cartesia`](./packages/cartesia/README.md) - Cartesia text-to-speech integration for real-time voice synthesis
- [`@micdrop/gradium`](./packages/gradium/README.md) - Gradium speech-to-text and text-to-speech integration with WebSocket streaming
- [`@micdrop/mistral`](./packages/mistral/README.md) - Mistral AI agent and speech-to-text integration for conversation handling
- [`@micdrop/gladia`](./packages/gladia/README.md) - Gladia speech-to-text integration for audio transcription

### Local Implementations

Running on your own machine, with no API key and no data leaving it.

- [`@micdrop/whisper`](./packages/whisper/README.md) - Local Whisper speech-to-text, in your Node process
- [`@micdrop/kokoro`](./packages/kokoro/README.md) - Local Kokoro text-to-speech, in your Node process, English only
- [`@micdrop/piper`](./packages/piper/README.md) - Local Piper text-to-speech, around forty languages
- [`@micdrop/pocket-tts`](./packages/pocket-tts/README.md) - Local Kyutai Pocket TTS text-to-speech, in your Node process, cloning a voice, English only
- [`@micdrop/qwen-tts`](./packages/qwen-tts/README.md) - Local Qwen3-TTS text-to-speech, ten languages, on an mlx-audio server

The agent runs locally through [`@micdrop/ai-sdk`](./packages/ai-sdk/README.md)
pointed at Ollama or any local server speaking the OpenAI protocol.

### Utility Packages

- [`@micdrop/react`](./packages/react/README.md) - React hooks for Micdrop, in the browser and in React Native

### Demo Applications

- [`basic`](./examples/basic/README.md) - The smallest possible app, one button in the browser and a WebSocket server, with OpenAI for the agent, the transcription and the voice. Start here.
- [`dictation`](./examples/dictation/README.md) - A call with ears only, no agent and no voice, filling a text area as you speak, in the language of the browser. Shows what a server looks like without an agent, and how a call parameter reaches it.
- [`advanced`](./examples/advanced/README.md) - Full featured demo, a React client and a Fastify server in one folder, with every provider wired in and picked from the browser.
- [`react-native`](./examples/react-native/README.md) - Voice call on a phone, an Expo app with the conversation, level meters and call controls, and the Node server it talks to.
- [`demo-world`](./examples/demo-world/README.md) - Immersive 3D demo where a newborn planet talks to you and reshapes itself as the conversation goes. Client and server in one folder, with a test page that runs the whole interface without a call.

## 🎥 Demo and technical details (video)

See the author [Godefroy de Compreignac](https://www.linkedin.com/in/godefroy) talking about Micdrop and voice AI in [this video](https://www.youtube.com/watch?v=fcqVOvESQ8o):

[![Youtube video](https://img.youtube.com/vi/fcqVOvESQ8o/0.jpg)](https://www.youtube.com/watch?v=fcqVOvESQ8o)

## 🤔 Why Micdrop?

While real-time multimodal models (voice-to-voice) offer impressive capabilities, they often come with limitations in terms of customization and cost. Micdrop takes a different approach by:

- 🎯 Allowing you to choose the best-in-class API for each component:
  - Select specific voices from TTS providers
  - Use different LLMs optimized for your use case
  - Pick STT engines suited for specific languages/accents
- 💰 Reducing costs by letting you:
  - Use more cost-effective API providers
  - Mix open source and commercial solutions
  - Control exactly when APIs are called
- 🔧 Providing granular control over the conversation flow
- 🌐 Supporting a wider range of languages and voices through specialized providers

This modular approach gives you the flexibility to build voice applications that are both powerful and cost-effective.

## 🌟 Features

- 🎙️ Microphone handling with:
  - Streaming support
  - Voice Activity Detection (VAD)
- 🔊 Advanced audio playback with:
  - Streaming support
  - Device selection and control
- 📱 The same call in the browser and in a React Native app, against one server
- 🌐 WebSocket communication
- 📦 AI implementations provided for OpenAI, ElevenLabs, Gradium, Mistral, Gladia, and more
- 🔌 Bring your own AI components (framework agnostic)
  - Large Language Models (LLM)
  - Text-to-Speech (TTS)
  - Speech-to-Text (STT)

## 🧪 Development

For detailed development instructions, including how to build, test, and publish packages, please see [DEVELOPMENT.md](DEVELOPMENT.md).

## 📄 License

MIT License - see the [LICENSE](LICENSE) file for details

## Author

Originally developed for [Raconte.ai](https://www.raconte.ai), created and open sourced by [Godefroy de Compreignac](https://github.com/Godefroy)

## Acknowledgements

Thanks to [ricky0123/vad](https://github.com/ricky0123/vad) for their work on voice activity detection.

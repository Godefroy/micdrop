# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
# Build all packages
pnpm build

# Build server and client only
pnpm build:server
pnpm build:client

# Build demo applications
pnpm build:demo

# Build documentation
pnpm build:doc

# Start main development servers (server + client)
pnpm dev:main

# Start demo development servers (demo-server + demo-client)
pnpm dev:demo

# Type-check individual packages (no global typecheck command)
pnpm --filter <package-name> typecheck

# Format code
pnpm format

# Clean build artifacts
pnpm clean
```

Don't co-author commits with Claude.

## Typescript Formatting

Follow this Prettierformatting for all Typescript code.

```json
{
  "semi": false,
  "singleQuote": true,
  "trailingComma": "es5"
}
```

## Monorepo Structure

This is a pnpm monorepo with packages in `packages/` and examples in `examples/`. Each package can be developed independently by running `pnpm dev` in the package directory.

### Core Architecture

- **@micdrop/client**: Browser library handling microphone input, audio playback, and WebSocket communication with the server
- **@micdrop/server**: Server implementation orchestrating audio streaming and AI integration
- **Agent System**: Abstract base class for LLM agents with conversation management and event handling
- **Modular AI Providers**: Separate packages for OpenAI, ElevenLabs, Cartesia, Mistral, and Gladia integrations

### Key Components

**MicdropClient** (`packages/client/src/client/MicdropClient.ts`):

- Manages WebSocket connection, microphone, and speaker
- Handles voice activity detection (VAD) and real-time audio streaming
- Emits state changes and manages conversation flow
- Key states: `isListening`, `isProcessing`, `isUserSpeaking`, `isAssistantSpeaking`

**MicdropServer** (`packages/server/src/MicdropServer.ts`):

- Orchestrates STT, Agent, and TTS components
- Handles WebSocket communication with clients
- Manages conversation flow and audio streaming
- Supports interruption and cancellation

**Agent** (`packages/server/src/agent/Agent.ts`):

- Abstract base class for AI agents with conversation management
- Emits events: `Message`, `CancelLastUserMessage`, `SkipAnswer`, `EndCall`
- Maintains conversation history and handles streaming responses

## Package Development

Each package uses:

- TypeScript with `tsconfig.json`
- Build tool: `tsup` (configured in `tsup.config.ts`)
- Output directory: `dist/`

When working on AI integrations, follow the established patterns:

- STT implements the `STT` interface with `transcribe()` method
- TTS implements the `TTS` interface with `speak()` method
- Agents extend the `Agent` base class and implement `answer()` and `cancel()`

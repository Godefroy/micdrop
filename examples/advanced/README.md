# Micdrop example app: full voice call with every provider

The full featured demo of [Micdrop](../../README.md), client and server in one
folder. Every provider the project ships with is wired in, and the call is
configured from the browser rather than from the code.

- [`client/`](./client) is a React application built with Vite, using
  [@micdrop/client](../../packages/client/README.md) and
  [@micdrop/react](../../packages/react/README.md)
- [`server/`](./server) is a Fastify server using
  [@micdrop/server](../../packages/server/README.md)

For a much shorter starting point, read [the basic example](../basic) first.

## Development

Copy the example environment file and fill in the API keys of the providers you
want to try:

```bash
cp .env.example .env
```

Then, from the root of the repository, build the packages once and start both
sides together:

```bash
pnpm install
pnpm build
pnpm dev:advanced
```

➡️ Client on http://localhost:8080, server on port 8081.

Other commands, run from this folder:

```bash
pnpm dev:client    # Client alone, with hot reload
pnpm dev:server    # Server alone, with hot reload
pnpm build         # Build both into dist/
pnpm start         # Run the built server
pnpm typecheck     # Typecheck both sides
```

## Choosing providers

The selects at the top of the page pick the language, the agent, the
transcription and the voice for the next call. The language starts on the one
of the browser, and a voice or a transcription model that speaks a single
language takes it over. The server exposes what it can run on
`GET /providers`, the client sends back what was picked when a call starts, and
a provider whose key is missing or whose binary is not installed appears greyed
out rather than failing mid-call. The selection is kept in the browser storage,
so it survives a reload.

Providers live in `server/src/providers`, one file per part of a call. Adding
one means adding one entry to the matching registry, and it shows up in the
client on the next page load.

The checkboxes under the selects turn the agent prompts on and off for the next
call: ending the call on its own, waiting on an unfinished sentence, and
skipping an answer when the transcript carries no speech. The client sends them
with the call and the server logs the ones left off. Each one costs the model a
tool call on every turn, and a small model handles them less reliably than a
hosted one, so unticking them one at a time shows which one a model mishandles.
Hover a label for what it does.

## Writing the prompt

The text area under the checkboxes holds the system prompt given to the agent.
It starts from the one the server exposes with its catalog, travels with the
call, and stays in the browser storage, so giving the assistant another
persona, another script or another task altogether is a matter of typing rather
than of editing `server/src/providers/agents.ts` and restarting. The language
of the conversation stays on the server side, which appends it after the prompt
since a voice or a transcription model locked to one language decides it.

Reset to default, at the bottom of the card, puts the whole server side back to
what the demo starts with: its preferred providers, its checkboxes and its
prompt.

## Running locally

The local providers need no API key and keep everything on the machine. Whisper
and Kokoro download their weights on first use, so the first call is slower than
the ones after it.

For the agent, install [Ollama](https://ollama.com) and pull a model:

```bash
brew services start ollama
ollama pull qwen3:4b-instruct
```

Pulling a model talks to the Ollama daemon, so the daemon has to be up first.
Running `ollama serve` works too, in a terminal of its own, since it holds the
one it runs in.

Every model pulled on the machine shows up in the agent select, so pull as many
as you want to compare. `hf.co/openbmb/MiniCPM5-2B-GGUF:Q4_K_M` answers a turn
about twice as fast as Qwen3 in English. The demo asks every Ollama model to
answer without reasoning, which Ollama maps to its `think` flag and a model
without a reasoning mode ignores.

For a voice in another language than English, install Piper and download a voice
into `examples/advanced/server/voices`, where the demo looks for them:

```bash
pip install piper-tts
mkdir -p server/voices && cd server/voices
BASE=https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR/siwis/medium
curl -LO $BASE/fr_FR-siwis-medium.onnx
curl -LO $BASE/fr_FR-siwis-medium.onnx.json
```

Every voice of the [samples page](https://rhasspy.github.io/piper-samples/) is
downloaded the same way, with its own path in the repository.

For a local English voice that clones a recording, extract the Pocket TTS
archive into `examples/advanced/server/models`, where the demo looks for it:

```bash
mkdir -p server/models && cd server/models
curl -LO https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/sherpa-onnx-pocket-tts-int8-2026-01-26.tar.bz2
tar xf sherpa-onnx-pocket-tts-int8-2026-01-26.tar.bz2
rm sherpa-onnx-pocket-tts-int8-2026-01-26.tar.bz2
```

The [local models guide](https://micdrop.dev/docs/ai-integration/local-models)
covers the models worth picking and what they cost in latency and memory.

## Dependencies

- React, Vite and Tailwind for the client
- Fastify for the server
- TypeScript on both sides
- Every `@micdrop/*` provider package

## License

MIT

## Author

[Godefroy de Compreignac](https://github.com/Godefroy)

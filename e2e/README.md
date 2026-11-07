# Micdrop end-to-end tests

Every integration, run against its real API through the situations a call puts
it in: an answer cut off, a second utterance before the first transcript, a
refused key, a connection that never opens.

The cloud providers are paid APIs, a run costs a few cents per provider. The
local ones (Kokoro, Phonon, Piper, Pocket TTS, Qwen3-TTS, Whisper) cost nothing,
and download their model on their first run.

## Running

```bash
pnpm test:e2e                 # Every provider whose keys are set
pnpm test:e2e cartesia        # One provider
pnpm test:e2e stt             # One kind: tts, stt, agent or realtime
pnpm test:e2e openai/agent    # One provider and kind
```

The keys come from `e2e/.env` (see `.env.example`), then from
`examples/advanced/.env`. A provider whose keys are missing is skipped, and so
is a local one whose model, binary or server is missing. The local models are
looked for where the advanced demo keeps them, with the same variables:
`PIPER_VOICES_DIR`, `PIPER_BINARY`, `POCKET_MODEL_DIR`, `PHONON_MODEL`,
`QWEN_URL` and `QWEN_MODEL`.

`E2E_ENV=none` loads no key, so every cloud provider is skipped and nothing is
billed, while the local ones still run. `E2E_SAVE_AUDIO=1` writes each voice heard to
`e2e/.cache/audio`, to listen to it.

The speech heard by the speech to text and realtime models is synthesized by
OpenAI on the first run, and kept in `e2e/.cache`.

## Layout

- `tests/<provider>/<kind>.test.ts` declares a provider and its options
- `src/scenarios/` holds what every provider of a kind has to do, so a new
  provider gets the whole set from a few lines
- `src/audio.ts` makes the speech, sends it like the client, and measures the
  voice that comes back
- `src/local.ts` finds the local models

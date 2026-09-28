# Ember, a storyteller voiced by Eleven v4

Ember tells a story by voice around a campfire. The LLM writes audio tags such
as `[whispers]`, `[laughs]` or `[wolf howling in the distance]` into its
answers, for [Eleven v4 Turbo](https://elevenlabs.io/blog/eleven-v4) to
perform. The page shows each tag apart from the words, as the answer is
written.

Switch the voice to Eleven Flash v2.5 on the page to hear the same storyteller
without tags. Flash would read the tags out loud, so the server then tells the
storyteller to write none.

Three files are worth reading:

- [`src/server.ts`](./src/server.ts) runs the call, with the prompt telling the
  LLM which tags it may write
- [`src/client.ts`](./src/client.ts) starts the call and draws the tags
- [`src/models.ts`](./src/models.ts) lists the two voice models

`ElevenLabsTTS` picks the WebSocket from the model: Eleven v4 streams over the
Text to Dialogue WebSocket, Flash over the Text to Speech one. The server
creates `ElevenLabsTTS` with the same options for both voices, apart from
`modelId`.

## Run it

```bash
cp .env.example .env # then fill in OPENAI_API_KEY and ELEVENLABS_API_KEY
pnpm install
pnpm dev:storyteller # from the root of the repository
```

Open http://localhost:8098, sit by the fire, and pick a scary story or a funny
one. OpenAI transcribes what you say and writes the answers, in English.

The voice comes from `ELEVENLABS_VOICE_ID`, Brian by default. Any voice of your
ElevenLabs library works, though a voice already trained on whispers or
laughter performs those tags more readily.

## License

MIT

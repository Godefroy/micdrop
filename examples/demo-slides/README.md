# Voice slides, laid out by Jev

Build a slide deck by speaking. Each transcript is read by
[Jev](https://docs.typesafe.ai), TypeSafe's System One model, through the
`classifier` of `MicdropServer` and `@micdrop/typesafe`, and the interface lays
out what it read before the LLM has written a word.

- **A few hundred ms after the transcript**, Jev tells whether new slides are
  asked for, how many, the layout of each among ten, and what happens to each
  existing slide (kept, edited or deleted). The interface shows skeletons in
  the right layouts, a shimmer on the slides being edited, and fades the ones
  being deleted.
- **A few seconds later**, the LLM applies the turn in a single call of its
  `update_slides` tool, which can add, edit and delete several slides at once,
  and fetches their photos in parallel.

The assistant has no voice: OpenAI transcribes what you say, and the answers
of the LLM are written above the deck.

The LLM follows Jev: before it answers, a system message tells it the deck as
numbered on screen and what Jev read, with the plan in its `metadata`.

| File                   | What it holds                                      |
| ---------------------- | -------------------------------------------------- |
| `src/shared/slides.ts` | The ten layouts, the slide model, the tool schema  |
| `src/shared/plan.ts`   | The questions asked to Jev, and the plan they give |
| `src/server/call.ts`   | The classifier, the agent, its tool, and the hint  |
| `src/server/deck.ts`   | Applying the operations, searching the photos      |
| `src/client/Deck.tsx`  | The slides, the skeletons and the pending changes  |

## Run it

```bash
cp .env.example .env # then fill in TYPESAFE_API_KEY and OPENAI_API_KEY
pnpm install
pnpm dev:slides # from the root of the repository
```

Open http://localhost:8092 and start talking. Photos come from
[Openverse](https://openverse.org), Creative Commons photos searched without a key.
Set `DEBUG=1` in `.env` to log each classification on the server.

Jev understands English best, so the deck is built in English.

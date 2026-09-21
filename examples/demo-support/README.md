# Nova Fiber support, routed by Jev

A support line for an internet provider, where each turn of the customer is
read by [Jev](https://docs.typesafe.ai), TypeSafe's System One model, through
the `classifier` of `MicdropServer` and `@micdrop/typesafe`. OpenAI transcribes,
answers and speaks.

Jev answers six typed questions in a single request of a few hundred ms: the
intent, the frustration, and whether the customer is in a hurry, about to
leave, asking for a human or trying to manipulate the assistant.

A turn can hold several transcripts when the customer pauses. Jev reads the
whole turn again each time one lands, and the answer waits for the
classification of the complete turn, so the route is decided before the LLM
writes a single token:

| Route    | When                               | Who answers                            |
| -------- | ---------------------------------- | -------------------------------------- |
| Block    | Manipulation attempt               | A scripted line, the LLM never sees it |
| Escalate | Asks for a human, or angry         | A scripted transfer line               |
| Code     | Reports an outage, with confidence | A scripted answer, instant and free    |
| Retain   | Thinks of leaving                  | The LLM, told it may offer a discount  |
| LLM      | Anything else                      | The LLM                                |

The questions live in `src/shared/questions.ts` and the routing in
`src/shared/routing.ts`, shared by the server that acts on it and the
interface that shows it.

## Run it

```bash
cp .env.example .env # then fill in TYPESAFE_API_KEY and OPENAI_API_KEY
pnpm install
pnpm dev:support # from the root of the repository
```

Open http://localhost:8090, call support, and try the lines suggested under
the conversation. Set `DEBUG=1` in `.env` to log each classification and its
duration on the server.

Jev understands English best, so the call is in English.

# Twenty questions, answered by Jev

The game thinks of something, and you find it by asking yes or no questions
out loud: "can you eat it?", "do you find it in a city?", "is it bigger than
a car?". These are free questions, tiresome to type and impossible to turn
into buttons. Say "give me a hint", "I give up" or "new game" when you need
to.

A second mode, picked in tabs before a call, turns it into "Who am I?": the
game plays a famous person or character, real or fictional, and you ask it
"are you a woman?", "did you live before 1900?". Jev reads that "you" means
the secret, and the game answers in the first person.

There is no agent and no voice: `MicdropServer` transcribes each turn, and
[Jev](https://docs.typesafe.ai), TypeSafe's System One model, answers it
through the `classifier` of the server, in a few hundred ms. Jev reads the
secret in its state, and gives the probability that the answer is yes. The
game turns it into an answer, and says "I don't know, it depends" when Jev
hesitates, because the question is ambiguous for this thing:

| Probability of a yes | Answer       |
| -------------------- | ------------ |
| 85 to 100%           | Yes          |
| 65 to 85%            | Probably     |
| 35 to 65%            | I don't know |
| 15 to 35%            | Probably not |
| 0 to 15%             | No           |

In the same request, Jev tells what the user does (a question, one that
cannot be answered by yes or no, a hint, giving up, a new game) and whether
the question names the secret itself, which wins the game.

The secret only exists on the server. Without an agent, the server writes
each answer itself with `addAssistantMessage()`, the reply in its metadata,
and the page draws the game from the conversation. Since the answers are in
the conversation, Jev reads the last one in `history`, so "and is it big?"
follows the question before.

| File                      | What it holds                                      |
| ------------------------- | -------------------------------------------------- |
| `src/server/secrets.ts`   | The things and the people to find, and their hints |
| `src/server/questions.ts` | The questions asked to Jev                         |
| `src/server/Game.ts`      | The rules: answers, hints, the end of a game       |
| `src/shared/replies.ts`   | The answer scale, and the replies sent to the page |
| `src/shared/modes.ts`     | The two modes, as the page shows them              |
| `src/client/useGame.ts`   | The game, read from the conversation               |

## Run it

```bash
cp .env.example .env # then fill in TYPESAFE_API_KEY and OPENAI_API_KEY
pnpm install
pnpm dev:twenty-questions # from the root of the repository
```

Open http://localhost:8096, pick something or someone, start playing and ask
your first question. Set `DEBUG=1` in `.env` to log each classification on the
server.

Jev understands English best, so the game is played in English.

# Bip, the robot you talk to

A small robot in a garden seen from above, that does what you tell it. There
is no agent and no voice: `MicdropServer` transcribes each turn, and
[Jev](https://docs.typesafe.ai), TypeSafe's System One model, reads it as a
command through the `classifier` of the server, in a few hundred ms. The
browser plays it out, and Bip answers in beeps and speech bubbles.

Jev reads each turn as up to three steps, each an action, a target, a
direction and a number of steps, so "take the bucket and water the red
flower" is two steps played one after the other. It also hears whether you
greet Bip, say please, congratulate it, insult it, or ask it to stop.

Eight quests wait in the garden: water the flower, cut down a tree, catch a
fish, open the chest, and a few more. The cat and the dog both love the ball
and fish, and only the dog eats apples and bananas.

| File                        | What it holds                                        |
| --------------------------- | ---------------------------------------------------- |
| `src/shared/commands.ts`    | The actions and targets, the questions asked to Jev  |
| `src/server/call.ts`        | A speech to text and a classifier, nothing else      |
| `src/client/game/world.ts`  | The garden, the things in it, the quests             |
| `src/client/game/Game.ts`   | What Bip does: paths, actions, reactions             |

## Run it

```bash
cp .env.example .env # then fill in TYPESAFE_API_KEY and OPENAI_API_KEY
pnpm install
pnpm dev:robot # from the root of the repository
```

Open http://localhost:8094, wake Bip up, and talk to it. Jev understands
English best, so Bip does too.

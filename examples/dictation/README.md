# Micdrop example app: live dictation, without agent and voice

A [Micdrop](https://micdrop.dev) call with ears only: no agent, no voice, just a
big text area that fills up as you speak.

It shows what a server looks like when `agent` and `tts` are left out: the call
transcribes, and each sentence lands at the end of the text area once the speech
to text has settled it.

Four files worth reading, around 200 lines in total:

- [`src/server.ts`](./src/server.ts) runs the call with a speech to text alone
- [`src/client.ts`](./src/client.ts) writes what is heard into the text area
- [`src/languages.ts`](./src/languages.ts) lists the languages both sides accept
- [`index.html`](./index.html) holds the microphone button and the page

## Run it

From the root of the repository, build the packages once:

```bash
pnpm install
pnpm build
```

Then add your OpenAI key:

```bash
cp .env.example .env
```

And start both the server and the page:

```bash
pnpm dev
```

➡️ http://localhost:8087

Press the microphone, allow it, and dictate. The text stays editable, and the
**Copy** button hands it to the clipboard.

## The language picker

It opens on the language of the browser. The page sends the chosen code as a
call parameter, the server validates it against the shared list and configures
the transcription for it, so changing the language opens a new call.

See [Auth and parameters](https://micdrop.dev/docs/server/auth-and-parameters).

## Another speech to text

Any of the provided integrations works here, the transcription being the only AI
component the call uses. Swapping `OpenaiSTT` for another one is a single line
in [`src/server.ts`](./src/server.ts).

See [the list of integrations](https://micdrop.dev/docs/providers).

## Where to go next

- [Dictation and text-only calls](https://micdrop.dev/docs/server/dictation)
- [Auth and parameters](https://micdrop.dev/docs/server/auth-and-parameters)
- [Client documentation](https://micdrop.dev/docs/client)

For a call with an agent and a voice, see [the basic example](../basic).

## License

MIT

# Micdrop example app: the smallest voice call in a browser

The smallest possible [Micdrop](https://micdrop.dev) app: a browser page with one
button, a Node WebSocket server, and OpenAI for the three AI steps (agent,
speech to text, text to speech).

Three files worth reading, around 150 lines in total:

- [`src/server.ts`](./src/server.ts) runs the call and plugs in the AI providers
- [`src/client.ts`](./src/client.ts) starts the call and displays its state
- [`index.html`](./index.html) holds the button and the conversation list

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

➡️ http://localhost:8084

Click **Start call**, allow the microphone, and talk.

## Where to go next

- [Getting started](https://micdrop.dev/docs/getting-started)
- [Client documentation](https://micdrop.dev/docs/client)
- [Server documentation](https://micdrop.dev/docs/server)
- [Other AI providers](https://micdrop.dev/docs/providers), including
  [models running on your own machine](https://micdrop.dev/docs/local-models)
- [React hooks](https://micdrop.dev/docs/client/react-hooks) for a real UI

For a full featured demo, with every provider wired in, see
[the advanced example](../advanced).

## License

MIT

# Micdrop example app: voice call on iOS and Android

A [Micdrop](https://micdrop.dev) voice call on a phone: one screen with a call
button, the conversation, two level meters, and the mute, pause and speaker
controls. The Node server next to it is the same one the
[basic example](../basic) uses.

Worth reading, around 400 lines in total:

- [`server/src/server.ts`](./server/src/server.ts) runs the call and plugs in the AI providers
- [`App.tsx`](./App.tsx) starts the call and draws its state
- [`src/config.ts`](./src/config.ts) finds the address of the server from the phone

## Run it

This app records and plays audio natively, so it needs a development build.
Expo Go will not do.

From the root of the repository, build the packages once:

```bash
pnpm install
pnpm build
```

Then add your OpenAI key, which belongs to the server:

```bash
cp server/.env.example server/.env
```

Start the server and the Metro bundler, which listen on 8087 and 8086:

```bash
pnpm dev
```

And, in another terminal, build and install the app:

```bash
pnpm ios
# or
pnpm android
```

Tap **Start the call**, allow the microphone, and talk.

The first build takes a few minutes, the ones after that are quick. Later runs
only need `pnpm dev`.

### The key stays out of the app

The OpenAI key sits in `server/.env` rather than at the root of the project, so
the app never sees it. Expo loads a root `.env` into its own process and
announces every variable it finds, which looks alarming even though only names
starting with `EXPO_PUBLIC_` ever reach the bundle. Keeping the key next to the
server it belongs to removes the question.

Never prefix a secret with `EXPO_PUBLIC_`: that prefix is exactly what puts a
value into the compiled app, in plain text, for anyone who unpacks it.

### iOS and Android only

`app.json` declares `"platforms": ["ios", "android"]`. Without it Expo also
offers a web target, and the dev server fails to bundle with
`Unable to resolve react-native-web`, since a voice call on a phone has no use
for it.

### Reaching the server

The app derives the server address from the one Expo served it on, so nothing
has to be configured:

| Where the app runs        | What it talks to                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| Android emulator          | `10.0.2.2`, the alias for the machine hosting it, since `localhost` there is the emulator itself |
| iOS simulator             | `localhost`, shared with the machine                                                             |
| A phone on the same Wi-Fi | the address Expo advertised, the machine's own                                                   |

The server listens on every interface for that reason. If your machine blocks
incoming connections, allow port 8087, or run the app on a simulator.

A phone plugged in over USB reaches the machine through
`adb reverse tcp:8087 tcp:8087` instead.

## What it shows

- Starting and stopping a call, with the microphone permission asked for you
- The conversation, kept up to date by the client
- Voice activity detection: the assistant stops as soon as you start talking
- Mute, pause, and switching between the loudspeaker and the earpiece
- Microphone and assistant levels, straight from the audio being captured and played

## Where to go next

- [React Native documentation](https://micdrop.dev/docs/react-native)
- [Server documentation](https://micdrop.dev/docs/server)
- [Other AI providers](https://micdrop.dev/docs/providers), including
  [models running on your own machine](https://micdrop.dev/docs/local-models)

For the browser, see [the basic example](../basic) and
[the advanced demo](../advanced).

## License

MIT

# 🧪 Development

### Development Commands

Build all packages

```bash
pnpm build
```

Run (watch) the client and server

```bash
pnpm dev:main
```

Run (watch) the basic example

```bash
pnpm dev:basic
```

Run (watch) the advanced demo, client and server together

```bash
pnpm dev:advanced
```

Run the React Native example, its server and the Metro bundler. Building the app
on a device or a simulator is a separate step, see
[its README](examples/react-native/README.md).

```bash
pnpm dev:react-native
```

Run (watch) the website and its documentation

```bash
pnpm dev:website
```

Run (watch) a specific package

```bash
pnpm --filter <package-name> dev
```

### Ports

Each example owns its own pair of ports, so several of them can run at the same
time without fighting over one.

| Example        | Client                   | Server |
| -------------- | ------------------------ | ------ |
| `advanced`     | 8080                     | 8081   |
| `demo-world`   | 8082                     | 8083   |
| `basic`        | 8084                     | 8085   |
| `react-native` | 8086 (the Metro bundler) | 8087   |

The website runs on 4321, the Astro default.

### Tests

`@micdrop/client`, `@micdrop/server` and `@micdrop/smart-turn` have unit test
suites that run in Node, up to a whole call between a client and a real
`MicdropServer`. They call no external service.

```bash
pnpm test
```

The end-to-end tests run every integration against its real API, which costs
money for the cloud providers, and against the local models installed. See
[e2e/README.md](e2e/README.md).

```bash
pnpm test:e2e             # Every provider whose keys are set
pnpm test:e2e cartesia    # One provider, or one kind (tts, stt, agent, realtime)
```

### Publishing to npm

#### Prerequisites

1. Create an npm account at [npmjs.com](https://npmjs.com)
2. Log in to npm in your terminal:

```bash
npm login
```

3. If you're using a scoped package (@micdrop), you'll need to:
   - Create an organization on npm (if not already done)
   - Ensure you have the right permissions in the organization

#### Publishing Steps

1. Go to the package directory:

```bash
cd packages/client
```

2. Update version number:

```bash
npm version patch  # For bug fixes (0.0.x)
npm version minor  # For new features (0.x.0)
npm version major  # For breaking changes (x.0.0)
```

3. Publish the package:

```bash
npm publish
```

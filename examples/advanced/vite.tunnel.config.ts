import { defineConfig, mergeConfig } from 'vite'
import base from './vite.config'

// Serves the demo through a single public origin, to test it on a phone:
//   npx vite --config vite.tunnel.config.ts
//   cloudflared tunnel --url http://localhost:8080
export default mergeConfig(
  base,
  defineConfig({
    plugins: [
      {
        name: 'tunnel-server-url',
        enforce: 'pre',
        transform(code, id) {
          if (id.endsWith('/client/src/providers.ts')) {
            return code.replace(
              "'http://localhost:8081'",
              'window.location.origin'
            )
          }
        },
      },
    ],
    server: {
      allowedHosts: ['.trycloudflare.com'],
      proxy: {
        '/providers': 'http://localhost:8081',
        '/call': { target: 'ws://localhost:8081', ws: true },
      },
    },
  })
)

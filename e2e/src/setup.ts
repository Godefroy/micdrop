import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'

// `E2E_ENV=none` loads no key, so every cloud provider is skipped and nothing
// is billed, while the local ones still run
if (process.env.E2E_ENV !== 'none') {
  // The keys of e2e/.env come first, then those of the advanced example,
  // which already holds every provider
  config({
    path: [
      fileURLToPath(new URL('../.env', import.meta.url)),
      fileURLToPath(new URL('../../examples/advanced/.env', import.meta.url)),
    ],
    quiet: true,
  })
}

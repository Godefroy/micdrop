import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['src/setup.ts'],
    // A real API takes seconds to answer, and audio plays in real time
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // The connections and the audio pacing rely on timers of their own
    pool: 'forks',
  },
})

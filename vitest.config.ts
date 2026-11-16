import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    environment: 'node',
    // `corpus/` is gitignored and absent from a fresh clone; its tests run
    // only where the private seed data is on disk.
    include: ['src/**/*.test.ts', 'corpus/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Outside Next's bundler, `server-only` resolves to its client-side stub,
      // which throws on import. Tests run in Node, so the guard is a no-op here.
      'server-only': fileURLToPath(new URL('./src/test/server-only-stub.ts', import.meta.url)),
    },
  },
})

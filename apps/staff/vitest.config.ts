import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    // UI tests drive real user events; give them room when the whole monorepo runs in parallel
    testTimeout: 20_000,
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    css: false,
    include: ['**/*.test.tsx', '**/*.test.ts'],
    exclude: ['node_modules', '.next'],
  },
});

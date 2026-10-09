import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    css: false,
    include: ['**/*.test.tsx', '**/*.test.ts'],
    exclude: ['node_modules', '.next'],
  },
});

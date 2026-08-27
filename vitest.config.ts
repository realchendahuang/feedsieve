import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
    'packages/*/src/**/*.test.ts',
    'apps/*/src/**/*.test.ts',
    'apps/*/entrypoints/**/*.test.ts',
    'apps/*/entrypoints/**/*.test.tsx',
  ],
  },
});

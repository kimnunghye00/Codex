import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/firebase-security.test.ts'],
    environment: 'node',
    setupFiles: ['tests/firebase-security.setup.ts'],
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});

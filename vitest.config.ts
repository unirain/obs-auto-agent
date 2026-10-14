import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['agents/reading/evals/**/*.test.ts'],
    maxWorkers: 4,
    testTimeout: 15000,
    hookTimeout: 15000,
    restoreMocks: true,
    passWithNoTests: false,
  },
});

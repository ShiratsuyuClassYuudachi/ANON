import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
    env: { JWT_SECRET: 'test-secret', NODE_ENV: 'test' },
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});

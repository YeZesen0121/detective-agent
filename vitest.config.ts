import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Bound file workers; SQLite race tests still launch their two real child processes.
  test: { include: ['tests/**/*.test.ts'], environment: 'node', maxWorkers: 4 },
});

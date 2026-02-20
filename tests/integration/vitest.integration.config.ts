import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    name: 'integration',
    globals: true,
    environment: 'node',
    setupFiles: ['./setup-integration-tests.ts'],
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/build/**'],
    testTimeout: 30000, // 30 seconds for integration tests
    hookTimeout: 10000,
    teardownTimeout: 10000,
    pool: 'forks', // Use separate processes for isolation
    poolOptions: {
      forks: {
        singleFork: true, // Run tests sequentially in separate processes
      },
    },
    reporters: ['default', 'json', 'html'],
    outputFile: {
      json: '../../test-reports/integration-results.json',
      html: '../../test-reports/integration-results.html',
    },
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: '../../test-reports/coverage',
      include: [
        'src/features/agent/**/*.ts',
        'src/features/workspace/**/*.ts',
        'src/shared/**/*.ts',
      ],
      exclude: ['**/*.test.ts', '**/*.spec.ts', '**/test/**', '**/tests/**', '**/__mocks__/**'],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
        statements: 70,
      },
    },
    benchmark: {
      include: ['**/performance.test.ts'],
      outputFile: '../../test-reports/benchmark.json',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '../../src'),
      $lib: path.resolve(__dirname, '../../src/lib'),
      $features: path.resolve(__dirname, '../../src/features'),
      $shared: path.resolve(__dirname, '../../src/shared'),
      $utils: path.resolve(__dirname, '../../src/utils'),
    },
  },
});

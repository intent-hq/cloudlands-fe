import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../..');
const coverageEnabled = process.env.VITEST_COVERAGE === 'true' || process.env.COVERAGE === 'true';

export default defineConfig({
  root: rootDir,
  test: {
    name: 'integration',
    globals: true,
    environment: 'node',
    setupFiles: [path.resolve(__dirname, './setup-integration-tests.ts')],
    include: ['tests/integration/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/build/**'],
    testTimeout: 30000, // 30 seconds for integration tests
    hookTimeout: 10000,
    teardownTimeout: 10000,
    pool: 'forks', // Use separate processes for isolation
    fileParallelism: false, // Run files sequentially for shared integration fixtures
    reporters: ['default', 'json', 'html'],
    outputFile: {
      json: '../../test-reports/integration-results.json',
      html: '../../test-reports/integration-results.html',
    },
    coverage: {
      enabled: coverageEnabled,
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
      $store: path.resolve(__dirname, '../../src/store'),
      $utils: path.resolve(__dirname, '../../src/utils'),
    },
  },
});

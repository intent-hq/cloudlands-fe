import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../..');
const coverageEnabled = process.env.VITEST_COVERAGE === 'true' || process.env.COVERAGE === 'true';

// CI-only budget headroom mirroring vitest.config.ts: the Integration Tests job
// runs on the shared self-hosted runner alongside the unit-shard legs, so it is
// exposed to the same load-induced starvation (intent-hq/monorepo#3082).
// Local runs are unchanged. std-env semantics: CI=false means "not CI".
const isCI = !!process.env.CI && process.env.CI !== 'false';

export default defineConfig({
  root: rootDir,
  test: {
    name: 'integration',
    globals: true,
    environment: 'node',
    setupFiles: [path.resolve(__dirname, './setup-integration-tests.ts')],
    include: ['tests/integration/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/build/**'],
    testTimeout: isCI ? 60_000 : 30_000, // 30 seconds for integration tests; 60s on loaded CI runners
    hookTimeout: isCI ? 30_000 : 10_000,
    teardownTimeout: 10000,
    pool: 'forks', // Use separate processes for isolation
    fileParallelism: false, // Run files sequentially for shared integration fixtures
    reporters: ['default', 'json', 'html'],
    outputFile: {
      json: path.resolve(rootDir, 'test-reports/integration-results.json'),
      html: path.resolve(rootDir, 'test-reports/integration-results.html'),
    },
    coverage: {
      enabled: coverageEnabled,
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: path.resolve(rootDir, 'test-reports/coverage'),
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
      outputFile: path.resolve(rootDir, 'test-reports/benchmark.json'),
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

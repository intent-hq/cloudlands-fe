#!/usr/bin/env tsx

import { spawn } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

try {
  require.resolve('@vitest/coverage-v8');
} catch {
  console.log('ℹ️  @vitest/coverage-v8 is not installed; skipping integration coverage.');
  console.log('   Run pnpm add -D @vitest/coverage-v8 to enable this suite.');
  process.exit(0);
}

const child = spawn(
  'pnpm',
  ['exec', 'vitest', 'run', '--config', 'tests/integration/vitest.integration.config.ts', '--coverage'],
  { stdio: 'inherit', env: { ...process.env, VITEST_COVERAGE: 'true' } },
);

child.on('close', (code) => process.exit(code ?? 1));
child.on('error', (error) => {
  console.error('Failed to run integration coverage:', error);
  process.exit(1);
});
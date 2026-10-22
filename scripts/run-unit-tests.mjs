#!/usr/bin/env node
// pnpm forwards a literal leading -- to Vitest, where it ends option parsing and
// can turn an intended focused run into the full suite. Reject it before preparation.
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTransferSelectionFixtures } from './transfer-selection-fixtures.mjs';
import {
  generatedBuildConfigPrerequisite,
  requiresTransferSelectionFixtures,
} from './unit-test-prerequisites.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

if (args[0] === '--') {
  console.error(
    'test:unit: remove the leading "--"; pnpm forwards it to Vitest and disables option parsing.\n' +
      'Use: pnpm run test:unit <file> -t "<name>" --maxWorkers=1\n' +
      'For the full suite: pnpm run test:unit',
  );
  process.exitCode = 2;
} else {
  // Keep the existing Node/dependency checks and stale-aware i18n preparation.
  for (const childArgs of [
    ['scripts/check-deps-fresh.mjs'],
    generatedBuildConfigPrerequisite({ root }).args,
    ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.config.ts', ...args],
  ]) {
    if (
      childArgs[0] === 'node_modules/vitest/vitest.mjs' &&
      requiresTransferSelectionFixtures(args)
    ) {
      try {
        await loadTransferSelectionFixtures();
      } catch (error) {
        console.error(
          `test:unit: ${error.message}\n` +
            'Use canonical contract.json, public-sessions.json, and scripts/check-transfer-selection-contract.mjs from one monorepo revision.\n' +
            'Use: TRANSFER_SELECTION_FIXTURE_ROOT=/path/to/intent/docs/protocol/fixtures/transfer-selection pnpm run test:unit <file> --maxWorkers=1',
        );
        process.exitCode = 1;
        break;
      }
    }
    const result = spawnSync(process.execPath, childArgs, {
      cwd: root,
      stdio: 'inherit',
      windowsHide: true,
    });
    if (result.error || result.signal) {
      console.error(
        `test:unit: ${childArgs[0]} ${result.error?.message ?? `terminated by ${result.signal}`}`,
      );
    }
    const exitCode = result.status ?? 1;
    if (exitCode !== 0) {
      process.exitCode = exitCode;
      break;
    }
  }
}

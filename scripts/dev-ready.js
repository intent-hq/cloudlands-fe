#!/usr/bin/env node
/**
 * Dev-build readiness sentinels for the concurrent dev startup.
 *
 * dev:base clears the sentinels (`clear`) before launching the concurrent
 * phase, and the build:*:dev wrappers write them (`main` / `preload`) only
 * after their compile finishes. dev-electron.js waits for both files, so a
 * stale dist/main/index.js from a previous run can never trigger a premature
 * Electron launch while the current compile is still in flight.
 */

import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(dirname(__dirname), 'dist');

const SENTINELS = {
  main: join(distDir, '.dev-ready-main'),
  preload: join(distDir, '.dev-ready-preload'),
};

const command = process.argv[2];

if (command === 'clear') {
  for (const file of Object.values(SENTINELS)) {
    rmSync(file, { force: true });
  }
} else if (command === 'main' || command === 'preload') {
  mkdirSync(distDir, { recursive: true });
  writeFileSync(SENTINELS[command], String(Date.now()));
} else {
  console.error('Usage: node scripts/dev-ready.js <clear|main|preload>');
  process.exit(1);
}

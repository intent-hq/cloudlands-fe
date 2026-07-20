#!/usr/bin/env tsx

import { existsSync } from 'fs';
import { join } from 'path';
import { spawn } from 'child_process';

function findPackagedApp(): string | undefined {
  const envPath = process.env.PACKAGED_APP_PATH;
  if (envPath) return existsSync(envPath) ? envPath : undefined;

  const root = process.cwd();
  const candidates = process.platform === 'win32'
    ? [join(root, 'dist-electron', 'win-unpacked', 'Intent.exe')]
    : [
      join(root, 'dist-electron', 'mac-arm64', 'Intent.app', 'Contents', 'MacOS', 'Intent'),
      join(root, 'dist-electron', 'mac', 'Intent.app', 'Contents', 'MacOS', 'Intent'),
    ];

  return candidates.find((candidate) => existsSync(candidate));
}

const packagedApp = findPackagedApp();
if (!packagedApp) {
  console.log('ℹ️  No packaged app found; skipping build-smoke tests.');
  console.log('   Run pnpm run dist:mac or set PACKAGED_APP_PATH to enable this suite.');
  process.exit(0);
}

const child = spawn(
  'pnpm',
  ['exec', 'playwright', 'test', '--config=e2e/build-smoke.config.ts', ...process.argv.slice(2)],
  { stdio: 'inherit', env: { ...process.env, PACKAGED_APP_PATH: packagedApp } },
);

child.on('close', (code) => process.exit(code ?? 1));
child.on('error', (error) => {
  console.error('Failed to run build-smoke tests:', error);
  process.exit(1);
});
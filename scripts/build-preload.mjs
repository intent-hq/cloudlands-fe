#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function buildPreload(root = ROOT) {
  // Even type-only imports cause tsc to emit their source files. Preload's
  // CommonJS output must never overwrite the main process's shared ESM files.
  const staging = mkdtempSync(path.join(tmpdir(), 'intent-preload-'));
  try {
    const options = { cwd: root, stdio: 'inherit' };
    execFileSync(
      process.execPath,
      [
        require.resolve('typescript/bin/tsc'),
        '-p',
        'tsconfig.preload.json',
        '--outDir',
        staging,
        '--tsBuildInfoFile',
        path.join(staging, 'preload.tsbuildinfo'),
        // Paths are relative to the final dist/preload map, not staging.
        '--sourceRoot',
        '../../src',
      ],
      options,
    );
    execFileSync(
      process.execPath,
      [
        require.resolve('tsc-alias/dist/bin/index.js'),
        '-p',
        'tsconfig.preload.json',
        '--outDir',
        staging,
      ],
      options,
    );
    mkdirSync(path.join(root, 'dist/preload'), { recursive: true });
    cpSync(path.join(staging, 'preload'), path.join(root, 'dist/preload'), { recursive: true });
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildPreload();
}

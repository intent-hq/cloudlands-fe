#!/usr/bin/env node
/**
 * Cross-platform script to launch Electron in dev mode
 * Replaces bash-specific scripts with Node.js for Windows compatibility
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { buildWaitOnEnv, buildWaitOnTargets, resolveWaitOnTimeoutMs } from './dev-electron-lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = dirname(__dirname);

// Parse arguments
const args = process.argv.slice(2);
const cdpMode = args.includes('--cdp');

// Get environment variables with defaults
const devPort = process.env.DEV_PORT || '5190';
const devInstance = process.env.DEV_INSTANCE || '';
const devInspectPort = process.env.DEV_INSPECT_PORT || '9229';
const waitOnTimeoutMs = resolveWaitOnTimeoutMs(process.env);

// Wait for the dev server AND the main/preload build sentinels. The sentinels
// are cleared by dev:base before the concurrent phase starts and written by
// build:main:dev / build:preload:dev only after their compile completes, so a
// stale dist/main/index.js left over from a previous (incremental) build can
// never trigger a premature Electron launch.
// The renderer probe additionally requires the generated SvelteKit client
// (node 0) to be fetchable over HTTP — a bare TCP listener is not enough: if
// Electron loads the window before Vite can serve the generated client
// modules, the renderer can stay stuck on a 500 error page that reloads do
// not recover from (intent-hq/monorepo#3524). See dev-electron-lib.mjs.
const waitOnTargets = buildWaitOnTargets(devPort, [
  join(rootDir, 'dist/.dev-ready-main'),
  join(rootDir, 'dist/.dev-ready-preload'),
]);

// Log the full target list so a stuck wait is self-diagnosing.
console.log(`Waiting for (timeout ${waitOnTimeoutMs}ms):\n  ${waitOnTargets.join('\n  ')}`);

const isWindows = process.platform === 'win32';
const waitOn = spawn('npx', ['wait-on', '--timeout', String(waitOnTimeoutMs), ...waitOnTargets], {
  cwd: rootDir,
  // NO_PROXY augmentation: keep the loopback http-get probe off any
  // configured HTTP proxy (see buildWaitOnEnv).
  env: buildWaitOnEnv(process.env),
  stdio: 'inherit',
  shell: isWindows,
});

waitOn.on('error', (err) => {
  console.error('Failed to wait for dev server:', err);
  process.exit(1);
});

waitOn.on('exit', (code) => {
  if (code !== 0) {
    console.error('wait-on failed with code:', code);
    console.error(
      `Hint: increase DEV_WAIT_ON_TIMEOUT_MS if these targets need more time: ${waitOnTargets.join(', ')}`,
    );
    process.exit(code ?? 1);
  }

  // Server is ready, launch Electron
  console.log(`Starting Electron with inspector on port ${devInspectPort}...`);

  const env = {
    ...process.env,
    NODE_ENV: 'development',
    DEV_PORT: devPort,
    DEV_INSTANCE: devInstance,
    DEV_INSPECT_PORT: devInspectPort,
    NODE_OPTIONS: '--max-old-space-size=8192',
  };

  if (cdpMode) {
    env.ENABLE_CDP_DEBUG = 'true';
  }

  // Collect extra Electron args (e.g. --ozone-platform=wayland on Linux)
  const extraArgs = process.env.ELECTRON_EXTRA_ARGS
    ? process.env.ELECTRON_EXTRA_ARGS.split(/\s+/).filter(Boolean)
    : [];

  const isWindows = process.platform === 'win32';
  const electron = spawn(
    'electron',
    [
      join(rootDir, 'dist/main/index.js'),
      `--inspect=${devInspectPort}`,
      '--no-sandbox',
      ...extraArgs,
    ],
    {
      cwd: rootDir,
      env,
      stdio: 'inherit',
      shell: isWindows,
    },
  );

  electron.on('error', (err) => {
    console.error('Failed to start Electron:', err);
    process.exit(1);
  });

  electron.on('exit', (code, signal) => {
    if (signal) {
      console.error(`Electron terminated by signal ${signal}`);
      process.exit(1);
    }
    process.exit(code ?? 1);
  });

  // Forward signals to Electron
  ['SIGINT', 'SIGTERM', 'SIGHUP'].forEach((signal) => {
    process.on(signal, () => {
      electron.kill(signal);
    });
  });
});

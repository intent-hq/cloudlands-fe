#!/usr/bin/env node
/**
 * Cross-platform script to launch Electron in dev mode
 * Replaces bash-specific scripts with Node.js for Windows compatibility
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = dirname(__dirname);

// Parse arguments
const args = process.argv.slice(2);
const cdpMode = args.includes('--cdp');

// Get environment variables with defaults
const devPort = process.env.DEV_PORT || '5190';
const devInstance = process.env.DEV_INSTANCE || '';
const devInspectPort = process.env.DEV_INSPECT_PORT || '9229';

console.log(`Waiting for Vite dev server at http://127.0.0.1:${devPort}...`);

// Wait for the dev server to be ready - use 127.0.0.1 to avoid IPv6 binding issues on Linux
const isWindows = process.platform === 'win32';
const waitOn = spawn('npx', ['wait-on', `http://127.0.0.1:${devPort}`], {
  cwd: rootDir,
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
    [join(rootDir, 'dist/main/index.js'), `--inspect=${devInspectPort}`, '--no-sandbox', ...extraArgs],
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

  electron.on('exit', (code) => {
    process.exit(code ?? 0);
  });

  // Forward signals to Electron
  ['SIGINT', 'SIGTERM', 'SIGHUP'].forEach((signal) => {
    process.on(signal, () => {
      electron.kill(signal);
    });
  });
});


#!/usr/bin/env node
// Runs package.json scripts through the pnpm that launched the current script.
//
// A bare `pnpm run x && pnpm run y` inside a package.json script resolves `pnpm` via PATH,
// which can be a different version from the `packageManager` pin and then refuses to run
// under corepack. `pnpmInvocation` re-enters the invoking pnpm (`npm_execpath`) instead.
//
// Usage: node scripts/pnpm-run.mjs <script> [<args>...]
//   Exactly one script name (the first argument); every remaining argument, including a
//   literal `--`, is forwarded verbatim as `pnpm run <script> <args>`. The wrapper never
//   consults package.json, so a caller positional that happens to equal another script
//   name is still data for <script>, never a second script to run. Chain scripts with the
//   shell instead: `node scripts/pnpm-run.mjs a && node scripts/pnpm-run.mjs b`. pnpm
//   appends extra CLI arguments to the end of the whole script string, so they reach the
//   last member of such a chain exactly as they did with bare nested `pnpm run`.

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { pnpmInvocation } from './pnpm-launcher.mjs';

export const USAGE = 'Usage: node scripts/pnpm-run.mjs <script> [<args>...]';

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export function parseArgs(argv) {
  const [script, ...forwarded] = argv;
  if (script === undefined || script === '--' || script.startsWith('-')) {
    throw new Error(`No script name given.\n${USAGE}`);
  }
  return { script, forwarded };
}

export function planInvocation({ script, forwarded }, options = {}) {
  return { script, ...pnpmInvocation(['run', script, ...forwarded], options) };
}

function spawnInherited(invocation) {
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.executable, invocation.args, {
      cwd: PACKAGE_ROOT,
      env: process.env,
      stdio: 'inherit',
      shell: invocation.shell,
      windowsVerbatimArguments: invocation.shell,
      windowsHide: true,
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code !== null) {
        resolve(code);
        return;
      }
      console.error(`pnpm-run: script "${invocation.script}" was terminated by ${signal}`);
      resolve(1);
    });
  });
}

async function main() {
  let plan;
  try {
    plan = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`pnpm-run: ${error.message}`);
    return 2;
  }
  return spawnInherited(planInvocation(plan));
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirectRun) {
  main().then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    (error) => {
      console.error(`pnpm-run: ${error.message}`);
      process.exitCode = 1;
    },
  );
}

#!/usr/bin/env node
// Runs package.json scripts through the pnpm that launched the current script.
//
// A bare `pnpm run x && pnpm run y` inside a package.json script resolves `pnpm` via PATH,
// which can be a different version from the `packageManager` pin and then refuses to run
// under corepack. `pnpmInvocation` re-enters the invoking pnpm (`npm_execpath`) instead.
//
// Usage: node scripts/pnpm-run.mjs <script> [<script>...] [-- <args>]
//   Scripts run sequentially; the first non-zero exit stops the chain and becomes this
//   process's exit code. Arguments after `--` are forwarded to the (single) script
//   exactly as `pnpm run <script> -- <args>` would pass them.

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { pnpmInvocation } from './pnpm-launcher.mjs';

export const USAGE = 'Usage: node scripts/pnpm-run.mjs <script> [<script>...] [-- <args>]';

export function parseArgs(argv) {
  const separator = argv.indexOf('--');
  const scripts = separator === -1 ? [...argv] : argv.slice(0, separator);
  const forwarded = separator === -1 ? [] : argv.slice(separator + 1);
  if (scripts.length === 0) {
    throw new Error(`No script name given.\n${USAGE}`);
  }
  const flag = scripts.find((script) => script.startsWith('-'));
  if (flag !== undefined) {
    throw new Error(`Unknown option "${flag}"; script names cannot start with "-".\n${USAGE}`);
  }
  if (forwarded.length > 0 && scripts.length > 1) {
    throw new Error(
      `Arguments after "--" can only be forwarded to a single script (got ${scripts.length}).\n${USAGE}`,
    );
  }
  return { scripts, forwarded };
}

export function planInvocations({ scripts, forwarded }, options = {}) {
  return scripts.map((script) => {
    const args = forwarded.length > 0 ? ['run', script, '--', ...forwarded] : ['run', script];
    return { script, ...pnpmInvocation(args, options) };
  });
}

export async function runInvocations(invocations, spawnScript) {
  for (const invocation of invocations) {
    const exitCode = await spawnScript(invocation);
    if (exitCode !== 0) return exitCode;
  }
  return 0;
}

function spawnInherited(invocation) {
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.executable, invocation.args, {
      cwd: dirname(dirname(fileURLToPath(import.meta.url))),
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
  return runInvocations(planInvocations(plan), spawnInherited);
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

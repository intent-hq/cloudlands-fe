#!/usr/bin/env node
// Runs package.json scripts through the pnpm that launched the current script.
//
// A bare `pnpm run x && pnpm run y` inside a package.json script resolves `pnpm` via PATH,
// which can be a different version from the `packageManager` pin and then refuses to run
// under corepack. `pnpmInvocation` re-enters the invoking pnpm (`npm_execpath`) instead.
//
// Usage: node scripts/pnpm-run.mjs <script> [<script>...] [<args>] [-- <args>]
//   Scripts run sequentially; the first non-zero exit stops the chain and becomes this
//   process's exit code. Script names are the leading arguments that are package.json
//   script names (and do not start with `-`); everything from the first other argument
//   (a `-`-prefixed flag, a positional that is not a script name, or `--`) onward is
//   forwarded verbatim to the LAST named script as `pnpm run <script> <args>`. pnpm
//   appends extra CLI arguments (including a literal `--`) to the end of the script
//   string, so `pnpm run <alias> --help` reaches the alias target exactly as the bare
//   nested `pnpm run` did.

import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { pnpmInvocation } from './pnpm-launcher.mjs';

export const USAGE = 'Usage: node scripts/pnpm-run.mjs <script> [<script>...] [<args>] [-- <args>]';

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export function parseArgs(argv, { isScript = () => true } = {}) {
  let split = argv.findIndex((arg) => arg.startsWith('-') || !isScript(arg));
  if (split === -1) split = argv.length;
  const scripts = argv.slice(0, split);
  const forwarded = argv.slice(split);
  if (scripts.length === 0) {
    throw new Error(`No script name given.\n${USAGE}`);
  }
  return { scripts, forwarded };
}

function packageScriptLookup() {
  const { scripts = {} } = JSON.parse(readFileSync(resolve(PACKAGE_ROOT, 'package.json'), 'utf8'));
  return (name) => Object.hasOwn(scripts, name);
}

export function planInvocations({ scripts, forwarded }, options = {}) {
  const last = scripts.length - 1;
  return scripts.map((script, index) => {
    const args = index === last ? ['run', script, ...forwarded] : ['run', script];
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
    plan = parseArgs(process.argv.slice(2), { isScript: packageScriptLookup() });
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

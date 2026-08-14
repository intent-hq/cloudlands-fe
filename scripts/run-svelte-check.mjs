#!/usr/bin/env node
/**
 * Plausibility-guarded svelte-check runner (intent-hq/monorepo#2240).
 *
 * svelte-check once completed "successfully" while checking almost nothing:
 * exit 0, 0 errors, instant completion, implausibly low file count. This
 * wrapper runs svelte-check with `--output machine-verbose`, re-prints
 * diagnostics in human-readable form, and fails loudly when the run looks
 * like a silent no-op even though svelte-check exited 0.
 *
 * It also runs `svelte-kit sync` first (intent-hq/monorepo#2378): svelte-check
 * reads whatever `.svelte-kit` typegen a previous dev/build run left behind,
 * so without a sync the generated route unions drift from the current route
 * tree and local results diverge from CI on the same commit.
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Repo has 800+ .svelte files alone; a plausible run checks far more. */
export const MIN_FILES = 500;

const MACHINE_LINE = /^\d+ (.*)$/;
const COMPLETED_LINE =
  /^COMPLETED (\d+) FILES (\d+) ERRORS (\d+) WARNINGS (\d+) FILES_WITH_PROBLEMS$/;

/**
 * Parse one machine-verbose output line into a structured event.
 * Returns null for lines that are not machine-format lines.
 */
export function parseMachineLine(line) {
  const match = MACHINE_LINE.exec(line);
  if (!match) return null;
  const body = match[1];
  const completed = COMPLETED_LINE.exec(body);
  if (completed) {
    return {
      kind: 'completed',
      files: Number(completed[1]),
      errors: Number(completed[2]),
      warnings: Number(completed[3]),
      filesWithProblems: Number(completed[4]),
    };
  }
  if (body.startsWith('START ')) return { kind: 'start' };
  if (body.startsWith('FAILURE '))
    return { kind: 'failure', message: body.slice('FAILURE '.length) };
  if (body.startsWith('{')) {
    try {
      const diagnostic = JSON.parse(body);
      if (diagnostic.type === 'ERROR' || diagnostic.type === 'WARNING') {
        return { kind: 'diagnostic', diagnostic };
      }
    } catch {
      // fall through to unknown
    }
  }
  return { kind: 'unknown', body };
}

/** Render a machine-verbose diagnostic like svelte-check's human writer. */
export function formatDiagnostic(diagnostic, workspaceDir = process.cwd()) {
  const { type, filename, start, message, source, code } = diagnostic;
  const file = path.isAbsolute(filename) ? path.relative(workspaceDir, filename) : filename;
  const position = start ? `:${start.line + 1}:${start.character + 1}` : '';
  const label = type === 'ERROR' ? 'Error' : 'Warn';
  const origin = source ?? code;
  return `${file}${position}\n${label}: ${message}${origin ? ` (${origin})` : ''}\n`;
}

/**
 * Decide whether a svelte-check run that exited 0 is plausible.
 * Returns a list of guard failure messages (empty when the run is sound).
 */
export function evaluateRun({ exitCode, completed, minFiles = MIN_FILES }) {
  if (exitCode !== 0) return [];
  if (!completed) {
    return [
      'svelte-check exited 0 without reporting a COMPLETED summary — output format changed or the run was cut short.',
    ];
  }
  const failures = [];
  if (completed.files < minFiles) {
    failures.push(
      `svelte-check reported only ${completed.files} checked files (plausibility floor: ${minFiles}). ` +
        'The run likely checked nothing — see intent-hq/monorepo#2240.',
    );
  }
  if (completed.errors > 0) {
    failures.push(`svelte-check exited 0 despite reporting ${completed.errors} errors.`);
  }
  return failures;
}

function resolveBin(packageName, binName) {
  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve(`${packageName}/package.json`);
  const pkg = require(`${packageName}/package.json`);
  const binRel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin[binName];
  return path.join(path.dirname(pkgPath), binRel);
}

/**
 * Environment for the typegen sync. svelte.config.js resolves the routes
 * directory from NODE_ENV (production builds sync against the filtered
 * `.svelte-kit/production-routes` copy, which excludes sandbox/test routes),
 * while svelte-check always checks `src/routes`. Force development so the
 * generated route unions match the tree being checked, regardless of what a
 * prior build left in NODE_ENV or `.svelte-kit`.
 */
export function syncEnv(env = process.env) {
  return { ...env, NODE_ENV: 'development' };
}

async function syncSvelteKitTypes() {
  const child = spawn(process.execPath, [resolveBin('@sveltejs/kit', 'svelte-kit'), 'sync'], {
    stdio: 'inherit',
    env: syncEnv(),
  });
  const exitCode = await new Promise((resolve) => {
    child.on('close', (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) {
    console.error(`svelte-kit sync failed with exit code ${exitCode} — route typegen is stale.`);
    process.exit(exitCode);
  }
}

async function main() {
  await syncSvelteKitTypes();
  const args = [
    '--tsconfig',
    './tsconfig.json',
    '--output',
    'machine-verbose',
    '--threshold',
    'error',
    ...process.argv.slice(2),
  ];
  const child = spawn(process.execPath, [resolveBin('svelte-check', 'svelte-check'), ...args], {
    stdio: ['inherit', 'pipe', 'inherit'],
    env: syncEnv(),
  });

  let completed = null;
  const rl = createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    const event = parseMachineLine(line);
    if (!event) {
      console.log(line);
      return;
    }
    if (event.kind === 'diagnostic') {
      console.log(formatDiagnostic(event.diagnostic));
    } else if (event.kind === 'completed') {
      completed = event;
    } else if (event.kind === 'failure') {
      console.error(`svelte-check failure: ${event.message}`);
    } else if (event.kind === 'unknown') {
      console.log(event.body);
    }
  });

  const exitCode = await new Promise((resolve) => {
    child.on('close', (code) => resolve(code ?? 1));
  });

  if (completed) {
    console.log(
      `svelte-check found ${completed.errors} errors and ${completed.warnings} warnings ` +
        `in ${completed.filesWithProblems} files (checked ${completed.files} files)`,
    );
  }

  const guardFailures = evaluateRun({ exitCode, completed });
  for (const failure of guardFailures) {
    console.error(`\nPLAUSIBILITY GUARD: ${failure}`);
  }
  process.exit(exitCode !== 0 ? exitCode : guardFailures.length > 0 ? 1 : 0);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  await main();
}

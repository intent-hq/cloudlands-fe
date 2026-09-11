#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const INSTALL_COMMAND = 'pnpm install --frozen-lockfile';
const LOCKFILE = 'pnpm-lock.yaml';
const INSTALLED_LOCKFILE = join('node_modules', '.pnpm', 'lock.yaml');

function readOptional(path) {
  try {
    return readFileSync(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export function checkDepsFresh(root = REPO_ROOT) {
  const lockfile = readFileSync(join(root, LOCKFILE));
  const installed = readOptional(join(root, INSTALLED_LOCKFILE));
  if (installed === null) {
    return {
      ok: false,
      status: 'missing',
      reason: `node_modules is missing (no ${INSTALLED_LOCKFILE}) — run: ${INSTALL_COMMAND}`,
    };
  }
  if (!lockfile.equals(installed)) {
    return {
      ok: false,
      status: 'stale',
      reason: `node_modules is out of sync with ${LOCKFILE} — run: ${INSTALL_COMMAND}`,
    };
  }
  return { ok: true, status: 'fresh', reason: null };
}

const isDirectRun =
  process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isDirectRun) {
  try {
    const result = checkDepsFresh();
    if (!result.ok) {
      console.error(`[deps:check] ${result.reason}`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`[deps:check] ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}

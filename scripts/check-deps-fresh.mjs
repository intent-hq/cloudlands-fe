#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const INSTALL_COMMAND = 'pnpm install --frozen-lockfile';
const LOCKFILE = 'pnpm-lock.yaml';
const INSTALLED_LOCKFILE = join('node_modules', '.pnpm', 'lock.yaml');

function readInstalled(path) {
  try {
    return { content: readFileSync(path), code: null };
  } catch (error) {
    return { content: null, code: error?.code ?? 'UNKNOWN' };
  }
}

export function checkDepsFresh(root = REPO_ROOT) {
  const lockfile = readFileSync(join(root, LOCKFILE));
  const installed = readInstalled(join(root, INSTALLED_LOCKFILE));
  if (installed.code === 'ENOENT') {
    return {
      ok: false,
      status: 'missing',
      reason: `node_modules is missing (no ${INSTALLED_LOCKFILE}) — run: ${INSTALL_COMMAND}`,
    };
  }
  if (installed.code !== null) {
    return {
      ok: false,
      status: 'unreadable',
      reason: `${INSTALLED_LOCKFILE} could not be read (${installed.code}) — run: ${INSTALL_COMMAND}`,
    };
  }
  if (!lockfile.equals(installed.content)) {
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

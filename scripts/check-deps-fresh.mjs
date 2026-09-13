#!/usr/bin/env node
// check-deps-fresh.mjs — the first command of lint, check, format:check and
// test:unit. It refuses to run a gate on a stale node_modules install and, once
// the install is fresh, provisions the gitignored Paraglide bundle
// (src/shared/paraglide) when it is missing or its recorded input hash no longer
// matches messages/*.json, so a cold checkout needs no manual generate:i18n.
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PARAGLIDE_STALE_MESSAGE, ensureRepoParaglide } from './paraglide-inputs-hash.mjs';

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

/**
 * Compile the Paraglide bundle only while it is missing or stale. Returns the
 * same `{ ok, reason }` shape as `checkDepsFresh` so gates report both steps alike.
 */
export async function ensureI18nFresh(root = REPO_ROOT, { ensure = ensureRepoParaglide } = {}) {
  const ok = await ensure({ rootDir: root, ifStale: true });
  return ok ? { ok: true, reason: null } : { ok: false, reason: PARAGLIDE_STALE_MESSAGE };
}

const isDirectRun =
  process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isDirectRun) {
  let deps;
  try {
    deps = checkDepsFresh();
    if (!deps.ok) {
      console.error(`[deps:check] ${deps.reason}`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`[deps:check] ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
  if (deps?.ok) {
    try {
      const i18n = await ensureI18nFresh();
      if (!i18n.ok) {
        console.error(`[generate:i18n] ${i18n.reason}`);
        process.exitCode = 1;
      }
    } catch (error) {
      console.error(`[generate:i18n] ${error instanceof Error ? error.message : error}`);
      process.exitCode = 1;
    }
  }
}

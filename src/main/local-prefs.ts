/**
 * FE-local main-process preferences helper.
 *
 * A single JSON file under `app.getPath('userData')` holds every FE-only
 * preference that has no daemon peer and no cross-process ownership: the
 * keychain access-prompt choice, the auto-updater channel opt-in, the
 * download-attribution bootstrap marker, and the feature-codes enrollment
 * list. These live on this side of the wire per PROTOCOL.md §5.12
 * ("Not exposed (FE-only)") and were previously scattered across the
 * `settings` electron-store; consolidating them here lets the legacy
 * electron-store dependency retire (P3-4).
 *
 * Fresh-start posture: this helper never reads the legacy electron-store
 * file. Existing users start from defaults on first launch.
 *
 * The read/write API is async because all callers already sit on async
 * paths; concurrent writes are serialized behind a promise chain so a
 * mid-write reader sees either the old or new value, not a torn file.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { Logger } from '../shared/logger';

const logger = new Logger('LocalPrefs');

/** File name inside `app.getPath('userData')`. */
const FILE_NAME = 'local-prefs.json';

/** In-flight write chain so concurrent writers serialize. */
let writeChain: Promise<void> = Promise.resolve();

function filePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME);
}

async function readAll(): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(filePath(), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      logger.warn('Failed to read local-prefs', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return {};
  }
}

async function writeAll(next: Record<string, unknown>): Promise<void> {
  const target = filePath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, JSON.stringify(next, null, 2), 'utf8');
}

/** Read a single FE-local preference; `undefined` when absent. */
export async function getLocalPref<T = unknown>(key: string): Promise<T | undefined> {
  const all = await readAll();
  return all[key] as T | undefined;
}

/** Return true iff `key` has been persisted (used for the download-attribution "already claimed" marker). */
export async function hasLocalPref(key: string): Promise<boolean> {
  const all = await readAll();
  return Object.prototype.hasOwnProperty.call(all, key);
}

/** Write a single FE-local preference (serialized). */
export async function setLocalPref(key: string, value: unknown): Promise<void> {
  writeChain = writeChain.then(async () => {
    const all = await readAll();
    all[key] = value;
    await writeAll(all);
  }).catch((error) => {
    logger.error('Failed to write local-prefs', error as Error);
  });
  return writeChain;
}

/** Delete a single FE-local preference (serialized). */
export async function deleteLocalPref(key: string): Promise<void> {
  writeChain = writeChain.then(async () => {
    const all = await readAll();
    if (!Object.prototype.hasOwnProperty.call(all, key)) return;
    delete all[key];
    await writeAll(all);
  }).catch((error) => {
    logger.error('Failed to delete local-prefs key', error as Error);
  });
  return writeChain;
}

/**
 * Test-only: reset the internal write chain so tests are isolated.
 * @internal
 */
export function __resetLocalPrefsWriteChainForTesting(): void {
  writeChain = Promise.resolve();
}

/**
 * Test-only: await any in-flight writes, then reset the chain.
 * Call this in afterEach before deleting temp directories to ensure
 * all file operations complete before cleanup.
 * @internal
 */
export async function __drainLocalPrefsWriteChainForTesting(): Promise<void> {
  await writeChain;
  writeChain = Promise.resolve();
}

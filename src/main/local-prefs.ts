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
 * Every key is listed in `local-pref-keys.ts`; the API accepts no other key.
 * A removed feature's keys move to its retired list, which startup deletes.
 *
 * Fresh-start posture: this helper never reads the legacy electron-store
 * file. Existing users start from defaults on first launch.
 *
 * The read/write API is async because all callers already sit on async
 * paths; concurrent writes are serialized behind a promise chain, and each
 * write lands via a same-directory temp file + `rename` so a mid-write
 * reader sees either the old or new complete document, never a torn file.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { isIntentOs } from '../shared/intent-os';
import { Logger } from '../shared/logger';
import {
  RETIRED_LOCAL_PREF_KEYS,
  type BooleanLocalPrefKey,
  type LocalPrefKey,
  type RetiredLocalPrefKey,
} from './local-pref-keys';

export type { BooleanLocalPrefKey, LocalPrefKey } from './local-pref-keys';

/** Keys the generic readers accept; boolean settings go through `getBooleanLocalPref`. */
type ValueLocalPrefKey = Exclude<LocalPrefKey, BooleanLocalPrefKey>;

const logger = new Logger('LocalPrefs');

/** File name inside `app.getPath('userData')`. */
const FILE_NAME = 'local-prefs.json';

/** In-flight write chain so concurrent writers serialize. */
let writeChain: Promise<void> = Promise.resolve();

/**
 * The parsed file. Code may name only registered keys; any other key on disk
 * (from a newer or older build) is kept as-is when the document is rewritten.
 */
type LocalPrefsDocument = Partial<Record<LocalPrefKey | RetiredLocalPrefKey, unknown>>;

function filePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME);
}

async function readAll(): Promise<LocalPrefsDocument> {
  try {
    const raw = await fs.readFile(filePath(), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as LocalPrefsDocument;
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

async function writeAll(next: LocalPrefsDocument): Promise<void> {
  const target = filePath();
  const dir = path.dirname(target);
  await fs.mkdir(dir, { recursive: true });
  const temp = path.join(dir, `.${FILE_NAME}.${process.pid}.${Date.now()}.tmp`);
  try {
    const handle = await fs.open(temp, 'w');
    try {
      await handle.writeFile(JSON.stringify(next, null, 2), 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temp, target);
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

/** Read a single FE-local preference; `undefined` when absent. */
export async function getLocalPref<T = unknown>(key: ValueLocalPrefKey): Promise<T | undefined> {
  const all = await readAll();
  return all[key] as T | undefined;
}

/** Return true iff `key` has been persisted (used for the download-attribution "already claimed" marker). */
export async function hasLocalPref(key: ValueLocalPrefKey): Promise<boolean> {
  const all = await readAll();
  return Object.prototype.hasOwnProperty.call(all, key);
}

/** Write a single FE-local preference (serialized). */
export async function setLocalPref(key: LocalPrefKey, value: unknown): Promise<void> {
  writeChain = writeChain
    .then(async () => {
      const all = await readAll();
      all[key] = value;
      await writeAll(all);
    })
    .catch((error) => {
      logger.error('Failed to write local-prefs', error as Error);
    });
  return writeChain;
}

/** Delete a single FE-local preference (serialized). */
export async function deleteLocalPref(key: LocalPrefKey): Promise<void> {
  writeChain = writeChain
    .then(async () => {
      const all = await readAll();
      if (!Object.prototype.hasOwnProperty.call(all, key)) return;
      delete all[key];
      await writeAll(all);
    })
    .catch((error) => {
      logger.error('Failed to delete local-prefs key', error as Error);
    });
  return writeChain;
}

/**
 * Drop `RETIRED_LOCAL_PREF_KEYS` (preferences of removed features) in one
 * write; no write when none is present.
 */
export async function deleteRetiredLocalPrefs(): Promise<void> {
  writeChain = writeChain
    .then(async () => {
      const all = await readAll();
      const present = RETIRED_LOCAL_PREF_KEYS.filter((key) =>
        Object.prototype.hasOwnProperty.call(all, key),
      );
      if (present.length === 0) return;
      for (const key of present) delete all[key];
      await writeAll(all);
    })
    .catch((error) => {
      logger.error('Failed to delete retired local-prefs keys', error as Error);
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

export interface BooleanLocalPrefPolicy {
  /** The value when the profile never chose: no file, or no key. */
  default: boolean;
  /** The value when the choice cannot be known: an unreadable or malformed file, or a non-boolean value. */
  onError: boolean;
}

/** Reads a boolean setting. Never rejects: a read it cannot trust returns `onError`. */
export async function getBooleanLocalPref(
  key: BooleanLocalPrefKey,
  policy: BooleanLocalPrefPolicy,
): Promise<boolean> {
  let value: unknown;
  try {
    value = (await readStrictPrefsDocument())[key];
  } catch (error) {
    logger.warn('Cannot read local-prefs; using the fallback for an unreadable file', {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
    return policy.onError;
  }
  if (value === undefined) return policy.default;
  if (typeof value === 'boolean') return value;
  logger.warn('local-prefs value is not a boolean; using the fallback', { key });
  return policy.onError;
}

/** The dock is on unless the user turned it off; a file that cannot be read keeps it off. */
export async function getDockLabEnabledLocalPref(): Promise<boolean> {
  return getBooleanLocalPref('dockLabEnabled', { default: true, onError: false });
}

export async function setDockLabEnabledLocalPref(enabled: boolean): Promise<void> {
  const write = writeChain.then(async () => {
    const all = await readAll();
    all.dockLabEnabled = enabled;
    await writeAll(all);
  });
  writeChain = write.catch((error) =>
    logger.error('Failed to persist dock Labs setting', error as Error),
  );
  return write;
}

/**
 * While the dock lab is on, the dock is visible by default (hidden by default
 * on Intent OS); Window menu changes persist locally and always win.
 */
export async function getDockEnabledLocalPref(): Promise<boolean> {
  return getBooleanLocalPref('dockEnabled', { default: !isIntentOs(), onError: false });
}

export async function setDockEnabledLocalPref(enabled: boolean): Promise<void> {
  await setLocalPref('dockEnabled', enabled);
}

/** Placement writes report failure to the caller while keeping the shared queue usable. */
export async function setDockPlacementLocalPref(
  placement: import('../shared/dock-placement').DockPlacement,
): Promise<void> {
  const write = writeChain.then(async () => {
    const all = await readAll();
    all.dockPlacement = { version: 1, placement };
    await writeAll(all);
  });
  writeChain = write.catch((error) =>
    logger.error('Failed to persist dock placement', error as Error),
  );
  return write;
}

/** Native shortcut changes must surface read/write failures, rather than invent defaults. */
export async function getDockShortcutOverridesLocalPref(): Promise<unknown> {
  const all = await readStrictPrefsDocument();
  return all.dockShortcutOverrides;
}
async function readStrictPrefsDocument(): Promise<LocalPrefsDocument> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath(), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('local-prefs is not a JSON object');
  return parsed as LocalPrefsDocument;
}
export async function setDockShortcutOverridesLocalPref(
  overrides: import('../shared/dock-shortcut-settings').DockShortcutOverrides,
): Promise<void> {
  const write = writeChain.then(async () => {
    const all = await readStrictPrefsDocument();
    all.dockShortcutOverrides = overrides;
    await writeAll(all);
  });
  writeChain = write.catch((error) =>
    logger.error('Failed to persist dock shortcuts', error as Error),
  );
  return write;
}

/** This preference changes only after a successful capture-editor Save transaction. */
export async function getDockMediaChoiceLocalPref(): Promise<
  import('../shared/dock-media-edit').DockMediaChoice | null
> {
  const { DockMediaChoiceSchema } = await import('../shared/dock-media-edit');
  const document = await readStrictPrefsDocument();
  const result = DockMediaChoiceSchema.safeParse(document.dockMediaLastSavedChoice);
  return result.success ? result.data : null;
}
export async function setDockMediaChoiceLocalPref(
  choice: import('../shared/dock-media-edit').DockMediaChoice,
): Promise<void> {
  const { DockMediaChoiceSchema } = await import('../shared/dock-media-edit');
  const accepted = DockMediaChoiceSchema.parse(choice);
  const write = writeChain.then(async () => {
    const document = await readStrictPrefsDocument();
    document.dockMediaLastSavedChoice = accepted;
    await writeAll(document);
  });
  writeChain = write.catch((error) =>
    logger.error('Failed to persist capture send options', error as Error),
  );
  return write;
}

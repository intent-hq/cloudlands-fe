/**
 * Last-used setup script per repository, kept in localStorage.
 *
 * This replaces the daemon-persisted saved-scripts store as the source of the
 * "last used for this repo" default in the workspace initializers: the value
 * is a local convenience (restore what the user ran last time), not domain
 * state, so it stays renderer-local. The map is bounded (newest
 * {@link MAX_REPOS} repos by `usedAt`) and every read/write is wrapped so a
 * corrupt or unavailable localStorage can never throw into a caller.
 */

import type { SetupScriptNameSource } from './repo-config';

// i18n-ignore (storage key, not user-facing)
export const LAST_USED_SETUP_SCRIPTS_STORAGE_KEY = 'setup-scripts:last-used-by-repo';

// i18n-ignore (storage key, not user-facing)
export const RECENT_SETUP_SCRIPTS_STORAGE_KEY = 'setup-scripts:recent-by-repo';

/** Newest N repos kept; older entries are evicted on write. */
export const MAX_REPOS = 20;

/** Newest N distinct scripts kept per repo in the recent history. */
export const MAX_RECENT_SCRIPTS_PER_REPO = 10;

const NAME_SOURCES: readonly SetupScriptNameSource[] = ['repo-config', 'custom', 'named'];

interface LastUsedSetupScript {
  name: string;
  content: string;
  /** ISO timestamp of the workspace creation that used the script. */
  usedAt: string;
  /**
   * True identity of `name` at record time — drives display-label
   * localization on restore. Absent on entries written before the field
   * existed; readers treat those as `'named'` (pass-through display).
   */
  nameSource?: SetupScriptNameSource;
}

type LastUsedMap = Record<string, LastUsedSetupScript>;
type RecentMap = Record<string, LastUsedSetupScript[]>;

/** A script the user ran for a repo, newest first in {@link getRecentSetupScripts}. */
export interface RecentSetupScript {
  name: string;
  content: string;
  nameSource: SetupScriptNameSource;
  /** ISO timestamp of the most recent workspace creation that used it. */
  usedAt: string;
}

/**
 * Storage key for a repo. Local repos key by path alone; GitHub selections
 * append the source URL because their `repoPath` is only the clone
 * destination, which two different repositories can share (mirrors
 * `repoIdentityKey` in the repo-config probe, which keys on the same
 * path + URL pair).
 */
function storageKey(repoPath: string, githubUrl?: string | null): string {
  return githubUrl ? `${repoPath}\u0000${githubUrl}` : repoPath;
}

function isValidEntry(value: unknown): value is LastUsedSetupScript {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.name === 'string' &&
    typeof entry.content === 'string' &&
    entry.content.trim().length > 0 &&
    typeof entry.usedAt === 'string' &&
    (entry.nameSource === undefined ||
      NAME_SOURCES.includes(entry.nameSource as SetupScriptNameSource))
  );
}

/** Read the map, folding a missing key, invalid JSON, or a non-object root
 * to an empty map and dropping malformed entries. Never throws. */
function readMap(): LastUsedMap {
  try {
    const raw = localStorage.getItem(LAST_USED_SETUP_SCRIPTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const map: LastUsedMap = {};
    for (const [repoPath, entry] of Object.entries(parsed)) {
      if (repoPath && isValidEntry(entry)) map[repoPath] = entry;
    }
    return map;
  } catch {
    return {};
  }
}

/** Read the per-repo history, dropping malformed repos and entries. Never throws. */
function readRecentMap(): RecentMap {
  try {
    const raw = localStorage.getItem(RECENT_SETUP_SCRIPTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const map: RecentMap = {};
    for (const [key, list] of Object.entries(parsed)) {
      if (!key || !Array.isArray(list)) continue;
      const entries = list.filter(isValidEntry);
      if (entries.length > 0) map[key] = entries;
    }
    return map;
  } catch {
    return {};
  }
}

/** Same script: same name, name source and trimmed content. */
function sameScript(a: LastUsedSetupScript, b: LastUsedSetupScript): boolean {
  return (
    a.name === b.name &&
    (a.nameSource ?? 'named') === (b.nameSource ?? 'named') &&
    a.content.trim() === b.content.trim()
  );
}

function newestFirst(entries: LastUsedSetupScript[]): LastUsedSetupScript[] {
  return [...entries].sort((a, b) => b.usedAt.localeCompare(a.usedAt));
}

/** Drop later duplicates, keeping each script's first (newest) occurrence. */
function dedupe(entries: LastUsedSetupScript[]): LastUsedSetupScript[] {
  const kept: LastUsedSetupScript[] = [];
  for (const entry of entries) {
    if (!kept.some((existing) => sameScript(existing, entry))) kept.push(entry);
  }
  return kept;
}

/**
 * Scripts used for a repo's workspace creations, newest first, each once.
 * Entries recorded before the history existed come from the single last-used
 * entry. Pass the source `githubUrl` for GitHub selections. Never throws.
 */
export function getRecentSetupScripts(
  repoPath: string,
  githubUrl?: string | null,
): RecentSetupScript[] {
  if (!repoPath) return [];
  const key = storageKey(repoPath, githubUrl);
  const history = readRecentMap()[key] ?? [];
  const legacy = readMap()[key];
  const merged = dedupe(newestFirst(legacy ? [...history, legacy] : history));
  return merged.slice(0, MAX_RECENT_SCRIPTS_PER_REPO).map((entry) => ({
    name: entry.name,
    content: entry.content,
    nameSource: entry.nameSource ?? 'named',
    usedAt: entry.usedAt,
  }));
}

/** Promote `entry` to the front of the repo's history. Never throws. */
function recordRecent(key: string, entry: LastUsedSetupScript, legacy?: LastUsedSetupScript) {
  try {
    const map = readRecentMap();
    const previous = map[key] ?? (legacy ? [legacy] : []);
    map[key] = dedupe([entry, ...newestFirst(previous)]).slice(0, MAX_RECENT_SCRIPTS_PER_REPO);
    const repos = Object.entries(map);
    if (repos.length > MAX_REPOS) {
      repos.sort(([, a], [, b]) => b[0].usedAt.localeCompare(a[0].usedAt));
      repos.length = MAX_REPOS;
    }
    localStorage.setItem(
      RECENT_SETUP_SCRIPTS_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(repos)),
    );
  } catch {
    // localStorage unavailable/full — losing the recent history is fine.
  }
}

/**
 * The last-used setup script for a repo, or undefined when none is recorded.
 * Pass the source `githubUrl` for GitHub selections (their `repoPath` is only
 * the clone destination). Never throws.
 */
export function getLastUsedSetupScript(
  repoPath: string,
  githubUrl?: string | null,
): { name: string; content: string; nameSource: SetupScriptNameSource } | undefined {
  if (!repoPath) return undefined;
  const entry = readMap()[storageKey(repoPath, githubUrl)];
  return entry
    ? { name: entry.name, content: entry.content, nameSource: entry.nameSource ?? 'named' }
    : undefined;
}

/**
 * Record the script used for a repo's workspace creation, and promote it in
 * the repo's recent history. Blank content is ignored; content is stored
 * trimmed. Pass the source `githubUrl` for GitHub
 * selections (their `repoPath` is only the clone destination). When the map
 * exceeds {@link MAX_REPOS} repos, the oldest entries (by `usedAt`) are
 * evicted. Never throws.
 */
export function recordLastUsedSetupScript(
  repoPath: string,
  script: { name: string; content: string; nameSource?: SetupScriptNameSource },
  githubUrl?: string | null,
): void {
  const content = script.content.trim();
  if (!repoPath || !content) return;
  const key = storageKey(repoPath, githubUrl);
  const entry: LastUsedSetupScript = {
    name: script.name,
    content,
    usedAt: new Date().toISOString(),
    nameSource: script.nameSource ?? 'named',
  };
  recordRecent(key, entry, readMap()[key]);
  try {
    const map = readMap();
    map[key] = entry;
    const entries = Object.entries(map);
    if (entries.length > MAX_REPOS) {
      entries.sort(([, a], [, b]) => b.usedAt.localeCompare(a.usedAt));
      entries.length = MAX_REPOS;
    }
    localStorage.setItem(
      LAST_USED_SETUP_SCRIPTS_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(entries)),
    );
  } catch {
    // localStorage unavailable/full — losing the convenience default is fine.
  }
}

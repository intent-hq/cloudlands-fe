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

// i18n-ignore (storage key, not user-facing)
export const LAST_USED_SETUP_SCRIPTS_STORAGE_KEY = 'setup-scripts:last-used-by-repo';

/** Newest N repos kept; older entries are evicted on write. */
export const MAX_REPOS = 20;

export interface LastUsedSetupScript {
  name: string;
  content: string;
  /** ISO timestamp of the workspace creation that used the script. */
  usedAt: string;
}

type LastUsedMap = Record<string, LastUsedSetupScript>;

function isValidEntry(value: unknown): value is LastUsedSetupScript {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.name === 'string' &&
    typeof entry.content === 'string' &&
    entry.content.trim().length > 0 &&
    typeof entry.usedAt === 'string'
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

/**
 * The last-used setup script for a repo, or undefined when none is recorded.
 * Never throws.
 */
export function getLastUsedSetupScript(
  repoPath: string,
): { name: string; content: string } | undefined {
  if (!repoPath) return undefined;
  const entry = readMap()[repoPath];
  return entry ? { name: entry.name, content: entry.content } : undefined;
}

/**
 * Record the script used for a repo's workspace creation. Blank content is
 * ignored; content is stored trimmed. When the map exceeds {@link MAX_REPOS}
 * repos, the oldest entries (by `usedAt`) are evicted. Never throws.
 */
export function recordLastUsedSetupScript(
  repoPath: string,
  script: { name: string; content: string },
): void {
  const content = script.content.trim();
  if (!repoPath || !content) return;
  try {
    const map = readMap();
    map[repoPath] = { name: script.name, content, usedAt: new Date().toISOString() };
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

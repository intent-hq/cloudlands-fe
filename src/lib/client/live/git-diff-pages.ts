/**
 * Bounded git diff reads (PROTOCOL §5.6 "Response budget"). The daemon packs
 * `git.diffs` and `git.branchDiff` results under its read budget: every
 * changed file keeps an entry, but a file whose body does not fit comes back
 * body-less with `truncated: true` and a `truncatedReason`:
 *
 * - `pageBudget` — the file fits on its own; asking again with `paths` set to
 *   the remaining files serves it.
 * - `fileTooLarge` — no diff read serves the file; read its sides with
 *   `git.showFile` / `file.read` instead (`git.branchDiff` entries carry the
 *   `oldRef` / `newRef` commit SHAs for that).
 *
 * When many files changed, the file list itself is paged: a cut result ends
 * with a continuation entry `{ nextToken }` (no path); asking again with that
 * `nextToken` returns the next files.
 *
 * Older daemons never send these keys, so these helpers pass their results
 * through unchanged.
 */

export type GitDiffTruncatedReason = 'fileTooLarge' | 'pageBudget';

/**
 * `maxBytes` the app sends on every bounded diff read: the daemon's default
 * bounded budget. It opts this client in to packed results whatever the
 * connection's defaults; older daemons ignore the param.
 */
export const GIT_DIFF_MAX_BYTES = 480_000;

type Request = (method: string, params: Record<string, unknown>) => Promise<unknown>;

/** The entry's `truncatedReason`, or `undefined` for a whole entry. */
export function gitDiffTruncatedReason(entry: unknown): GitDiffTruncatedReason | undefined {
  if (!entry || typeof entry !== 'object') return undefined;
  const e = entry as { truncated?: unknown; truncatedReason?: unknown };
  if (e.truncated !== true) return undefined;
  return e.truncatedReason === 'pageBudget' ? 'pageBudget' : 'fileTooLarge';
}

function entryPath(entry: unknown, key: 'path' | 'file'): string | undefined {
  if (!entry || typeof entry !== 'object') return undefined;
  const value = (entry as Record<string, unknown>)[key];
  return typeof value === 'string' && value ? value : undefined;
}

/** The `nextToken` of a continuation entry (an entry without a path). */
function continuationToken(entry: unknown, key: 'path' | 'file'): string | undefined {
  if (!entry || typeof entry !== 'object' || entryPath(entry, key) !== undefined) return undefined;
  const token = (entry as { nextToken?: unknown }).nextToken;
  return typeof token === 'string' && token ? token : undefined;
}

/**
 * One read with its file list drained: follow each continuation entry's
 * `nextToken` until the daemon sends none. Continuation entries are dropped.
 * `undefined` when the first reply is not an array.
 */
export async function readFileList(
  request: Request,
  method: string,
  params: Record<string, unknown>,
  pathKey: 'path' | 'file',
): Promise<unknown[] | undefined> {
  const entries: unknown[] = [];
  const seenTokens = new Set<string>();
  let token: string | undefined;
  do {
    const page = await request(method, token ? { ...params, nextToken: token } : params);
    if (!Array.isArray(page)) return token ? entries : undefined;
    token = undefined;
    for (const entry of page) {
      const next = continuationToken(entry, pathKey);
      if (next !== undefined) token = next;
      else entries.push(entry);
    }
    // Every page moves past at least one file; a repeated token would loop.
    if (token !== undefined) {
      if (seenTokens.has(token)) break;
      seenTokens.add(token);
    }
  } while (token !== undefined);
  return entries;
}

/**
 * Call a bounded diff method (opting in with `maxBytes`), drain its file list
 * (`nextToken`) and fill in its `pageBudget` entries by asking again for the
 * remaining paths, so the caller sees the same complete result an unbounded
 * read gave. `fileTooLarge` entries are returned as-is for the caller to
 * resolve. Entry order follows the first read.
 *
 * Follow-ups continue while they make progress: each one serves at least one
 * more file, and a stalled many-path follow-up retries with a single path
 * (always served unless `fileTooLarge`) before giving up.
 *
 * `pathKey` is the entry's path field: `path` for `git.diffs`, `file` for
 * `git.branchDiff`.
 */
export async function requestAllDiffPages(
  request: Request,
  method: 'git.diffs' | 'git.branchDiff',
  params: Record<string, unknown>,
  pathKey: 'path' | 'file',
): Promise<unknown[]> {
  const opted: Record<string, unknown> = {
    ...params,
    maxBytes: params.maxBytes ?? GIT_DIFF_MAX_BYTES,
  };
  const first = await readFileList(request, method, opted, pathKey);
  if (!first) return [];
  const entries = [...first];
  const indexByPath = new Map<string, number>();
  entries.forEach((entry, i) => {
    const path = entryPath(entry, pathKey);
    if (path !== undefined) indexByPath.set(path, i);
  });
  let pending = entries
    .filter((entry) => gitDiffTruncatedReason(entry) === 'pageBudget')
    .map((entry) => entryPath(entry, pathKey))
    .filter((path): path is string => path !== undefined);
  // `paths` replaces the narrowing on follow-ups; `path` would union back in.
  const { path: _path, paths: _paths, ...base } = opted;
  let stalled = false;
  while (pending.length > 0) {
    // A many-path request can be spent on the reserve for its truncated
    // rows alone; one path is always served unless it is fileTooLarge.
    const ask = stalled ? pending.slice(0, 1) : pending;
    const page = await readFileList(request, method, { ...base, paths: ask }, pathKey);
    if (!page) break;
    const asked = new Set(ask);
    const stillPending = new Set<string>();
    for (const entry of page) {
      const path = entryPath(entry, pathKey);
      if (path === undefined || !asked.has(path)) continue;
      if (gitDiffTruncatedReason(entry) === 'pageBudget') {
        stillPending.add(path);
        continue;
      }
      const index = indexByPath.get(path);
      if (index !== undefined) entries[index] = entry;
    }
    // A path the follow-up no longer lists (its change went away) is done.
    const next = pending.filter((path) => !asked.has(path) || stillPending.has(path));
    if (next.length === pending.length) {
      if (stalled) break;
      stalled = true;
    } else {
      stalled = false;
    }
    pending = next;
  }
  return entries;
}

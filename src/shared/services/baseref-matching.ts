/**
 * baseRef matching helpers
 *
 * Decides whether a PR's `sourceBranch` (as returned by GitHub) matches a
 * workspace's `baseRef`. A workspace may store `baseRef` either as a plain
 * local branch name (e.g. `"main"`, `"feature/foo"`) or as a remote-qualified
 * ref (e.g. `"origin/main"`). PR `sourceBranch` values from the GitHub API
 * never include a remote prefix.
 *
 * To bridge that gap without over-stripping legitimate slashed local branches,
 * we only strip the first path segment when it is a known remote from a
 * conservative allowlist. This keeps `baseRef = "feature/foo"` from falsely
 * matching a PR with `sourceBranch = "foo"`.
 *
 * Pure string logic — no stores, no IPC, no side effects. Safe to import from
 * both main and renderer processes.
 */

/**
 * Conservative allowlist of remote names whose first path segment may be
 * stripped for PR `sourceBranch` comparison.
 */
const KNOWN_REMOTE_PREFIXES = ['origin/', 'upstream/', 'fork/'] as const;

/**
 * Return the portion of `baseRef` after the first `/` when it is prefixed
 * with a known remote from the allowlist, otherwise `null`.
 */
function stripKnownRemotePrefix(baseRef: string): string | null {
  for (const prefix of KNOWN_REMOTE_PREFIXES) {
    if (baseRef.startsWith(prefix) && baseRef.length > prefix.length) {
      return baseRef.slice(prefix.length);
    }
  }
  return null;
}

/**
 * Returns true if a PR's `sourceBranch` matches a workspace's `baseRef`.
 *
 * Rules:
 * - Empty/nullish inputs return `false`.
 * - Raw equality (`prSourceBranch === baseRef`) is always honored, which
 *   handles plain branches like `"main"` and local branches with slashes
 *   like `"feature/foo"`.
 * - If `baseRef` begins with a known remote prefix from the allowlist
 *   (`"origin/"`, `"upstream/"`, `"fork/"`), the portion after the first
 *   `/` is also compared against `prSourceBranch`.
 * - First path segments outside the allowlist are NOT stripped, so
 *   `baseRef = "feature/foo"` will NOT match `prSourceBranch = "foo"`.
 */
export function matchesBaseRef(
  prSourceBranch: string | undefined | null,
  baseRef: string | undefined | null,
): boolean {
  if (!prSourceBranch || !baseRef) return false;
  if (prSourceBranch === baseRef) return true;
  const stripped = stripKnownRemotePrefix(baseRef);
  return stripped !== null && stripped === prSourceBranch;
}

/**
 * Returns the non-empty set of branch strings that callers should add to a
 * `branchesToMatch` set when scanning open PRs by source branch.
 *
 * Uses the same allowlist rule as {@link matchesBaseRef}:
 * - `"origin/foo"` → `["origin/foo", "foo"]`
 * - `"upstream/release/1.0"` → `["upstream/release/1.0", "release/1.0"]`
 * - `"feature/foo"` → `["feature/foo"]` (not stripped — not a known remote)
 * - `"main"` → `["main"]`
 * - `undefined` / `""` → `[]`
 */
export function getBaseRefMatchCandidates(
  baseRef: string | undefined | null,
): string[] {
  if (!baseRef) return [];
  const candidates = [baseRef];
  const stripped = stripKnownRemotePrefix(baseRef);
  if (stripped !== null && stripped !== baseRef) {
    candidates.push(stripped);
  }
  return candidates;
}

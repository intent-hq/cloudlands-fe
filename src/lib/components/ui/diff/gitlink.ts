/**
 * Gitlink (submodule) diff-chunk helpers (intent-hq/monorepo#1739).
 *
 * A submodule entry in a git tree (mode 160000) has no blob content, so
 * `git.showFile` fails for it (`-32603`) and `file.read` fails too (the path
 * is a directory in the worktree). libgit2 renders a gitlink delta as
 * pseudo-content lines of the form `Subproject commit <sha>` (with an
 * optional `-dirty` suffix), which the daemon's `git.diffs` hunks carry
 * verbatim. These helpers let the diff pipeline recognize such chunks from
 * the hunks it already has and compose their two full-content sides from the
 * hunk lines instead of issuing content reads that can only fail.
 */

// Full object ID only: 40 hex chars (sha1) or 64 (sha256) — libgit2 always
// emits the full OID in the pseudo-line, so anything shorter is a regular
// file line that merely resembles one.
const GITLINK_LINE_RE = /^Subproject commit ([0-9a-f]{40}|[0-9a-f]{64})(-dirty)?\n?$/;

interface GitlinkHunkLine {
  type?: unknown;
  content?: unknown;
}

function hunkLines(hunk: unknown): unknown[] | null {
  const lines = (hunk as { lines?: unknown } | null)?.lines;
  return Array.isArray(lines) ? lines : null;
}

/**
 * True when a `git.diffs` chunk is a gitlink (submodule) entry. A gitlink
 * delta is structurally constrained: exactly one hunk with one or two lines,
 * each a Deletion or Addition (never Context — the pseudo-line only appears
 * when the pin changed) whose content is a full-OID `Subproject commit <sha>`
 * pseudo-line. Regular files whose changed lines happen to record such text
 * (e.g. a generated pin manifest) carry context lines and/or more hunks and
 * are rejected.
 */
export function isGitlinkDiffChunk(chunk: { chunks?: unknown[] }): boolean {
  const hunks = chunk.chunks;
  if (!Array.isArray(hunks) || hunks.length !== 1) return false;
  const lines = hunkLines(hunks[0]);
  if (!lines || lines.length === 0 || lines.length > 2) return false;
  for (const line of lines) {
    const { type, content } = (line ?? {}) as GitlinkHunkLine;
    if (type !== 'Deletion' && type !== 'Addition') return false;
    if (typeof content !== 'string' || !GITLINK_LINE_RE.test(content)) return false;
  }
  return true;
}

/**
 * Compose the full-content sides of a gitlink chunk from its hunk lines
 * (Deletion → old, Addition → new), mirroring what `git.showFile` would have
 * returned had gitlinks carried blob content. An added (removed) submodule
 * pin yields an empty old (new) side.
 */
export function gitlinkSidesFromHunks(hunks: unknown[]): {
  oldContent: string;
  newContent: string;
} {
  let oldContent = '';
  let newContent = '';
  for (const hunk of hunks) {
    for (const line of hunkLines(hunk) ?? []) {
      const { type, content } = (line ?? {}) as GitlinkHunkLine;
      if (typeof content !== 'string') continue;
      const body = content.endsWith('\n') ? content : `${content}\n`;
      if (type !== 'Addition') oldContent += body;
      if (type !== 'Deletion') newContent += body;
    }
  }
  return { oldContent, newContent };
}

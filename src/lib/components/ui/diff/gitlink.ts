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

const GITLINK_LINE_RE = /^Subproject commit [0-9a-f]{4,64}(-dirty)?\n?$/;

interface GitlinkHunkLine {
  type?: unknown;
  content?: unknown;
}

function hunkLines(hunk: unknown): unknown[] | null {
  const lines = (hunk as { lines?: unknown } | null)?.lines;
  return Array.isArray(lines) ? lines : null;
}

/**
 * True when a `git.diffs` chunk is a gitlink (submodule) entry: it has at
 * least one hunk line and every hunk line is a `Subproject commit <sha>`
 * pseudo-line.
 */
export function isGitlinkDiffChunk(chunk: { chunks?: unknown[] }): boolean {
  const hunks = chunk.chunks;
  if (!Array.isArray(hunks) || hunks.length === 0) return false;
  let sawLine = false;
  for (const hunk of hunks) {
    const lines = hunkLines(hunk);
    if (!lines) return false;
    for (const line of lines) {
      const content = (line as GitlinkHunkLine | null)?.content;
      if (typeof content !== 'string' || !GITLINK_LINE_RE.test(content)) return false;
      sawLine = true;
    }
  }
  return sawLine;
}

/**
 * Compose the full-content sides of a gitlink chunk from its hunk lines
 * (Deletion → old, Addition → new, Context → both), mirroring what
 * `git.showFile` would have returned had gitlinks carried blob content. An
 * added (removed) submodule pin yields an empty old (new) side.
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

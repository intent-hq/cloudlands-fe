/**
 * Spec-link extraction & UI status-set helpers.
 *
 * The canonical workspace-wide task progress aggregate is owned by the BE and
 * served verbatim through `task.list` (PROTOCOL §5.4) — see the
 * `selectWorkspaceTaskProgress` selector. The helpers here are PRESENTATIONAL:
 *
 *   - `extractSpecTaskIds` / `extractOrderedSpecTaskIds` / `getSpecTaskNotes`
 *     parse `intent://local/task/{id}` links from markdown for tree/sort code.
 *   - `IN_PROGRESS_STATUSES` / `EXCLUDED_STATUSES` are reused by display logic
 *     (ordering, colouring, filtering) — they MUST NOT be used to compute the
 *     workspace task-progress rollup. The renderer never re-derives that
 *     rollup; it renders the BE's `WorkspaceTaskStats` directly.
 */

import type { Note, TaskStatus } from '../types';
import { isSpecNote } from '../constants/notes';
import { TASK_LINK_REGEX_FLEXIBLE } from '../constants/intent-links';

// ---------------------------------------------------------------------------
// Status classification constants
// ---------------------------------------------------------------------------

/** Statuses that count as "in progress" for progress tracking. */
export const IN_PROGRESS_STATUSES: ReadonlySet<TaskStatus> = new Set([
  'in_progress',
  'review_required',
]);

/**
 * Statuses excluded from progress totals entirely (neither done nor in-progress).
 * Note: `discussion_needed` and `blocked` are intentionally NOT in either set —
 * they count toward the total but never as inProgress.
 */
export const EXCLUDED_STATUSES: ReadonlySet<TaskStatus> = new Set(['cancelled']);

// ---------------------------------------------------------------------------
// Spec content helpers
// ---------------------------------------------------------------------------

/**
 * Extract the set of task note IDs linked in markdown content via
 * `[text](intent://local/task/{id})` links.
 */
export function extractSpecTaskIds(content: string | undefined): Set<string> {
  if (!content) return new Set();
  const ids = new Set<string>();
  const re = new RegExp(TASK_LINK_REGEX_FLEXIBLE.source, 'g');
  for (const match of content.matchAll(re)) {
    const noteId = match[2];
    if (noteId) ids.add(noteId);
  }
  return ids;
}

/**
 * Same as {@link extractSpecTaskIds} but returns IDs in the order they appear
 * in the content (useful for sorting roots to match spec order).
 */
export function extractOrderedSpecTaskIds(content: string | undefined): string[] {
  if (!content) return [];
  const ids: string[] = [];
  const re = new RegExp(TASK_LINK_REGEX_FLEXIBLE.source, 'g');
  for (const match of content.matchAll(re)) {
    const noteId = match[2];
    if (noteId && !ids.includes(noteId)) ids.push(noteId);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Canonical task filtering
// ---------------------------------------------------------------------------

/**
 * Filter notes to the set of spec-linked root task notes.
 *
 * A note passes the filter when ALL of the following are true:
 *   1. It has task metadata (`note.metadata.task`)
 *   2. It is NOT the spec note itself
 *   3. Its parentId IS the spec note (direct child)
 *   4. If the spec content contains task links, the note's ID appears among them
 *      (falls back to all direct children when spec has no links — backward compat)
 *   5. It is not a duplicate (first occurrence wins)
 *
 * This is the **single source of truth** for "which tasks count toward progress".
 */
export function getSpecTaskNotes(notes: Note[]): Note[] {
  const specNote = notes.find((n) => isSpecNote(n.id as string));
  const specTaskIds = extractSpecTaskIds(specNote?.content);
  const hasSpecLinks = specTaskIds.size > 0;

  const seen = new Set<string>();
  return notes.filter((n) => {
    if (!n.metadata?.task) return false;
    if (isSpecNote(n.id as string)) return false;
    if (!isSpecNote(n.parentId as string)) return false;
    const id = n.id as string;
    if (hasSpecLinks && !specTaskIds.has(id)) return false;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Per-note linked-task aggregate (NOT the workspace task-progress rollup)
// ---------------------------------------------------------------------------

/**
 * Shape of the per-note linked-task aggregate produced by `parseTaskStats`
 * (sidebar utils). This is a LOCAL per-note count for hover tooltips on
 * non-spec notes that link to task notes — it is NOT the workspace-wide
 * `WorkspaceTaskStats` rollup that lives behind `task.list` (PROTOCOL §5.4).
 */
export interface TaskStats {
  total: number;
  completed: number;
  inProgress: number;
}


/**
 * Canonical task filtering and counting utilities.
 *
 * ALL task progress computation should flow through these functions to ensure
 * consistency across the server (workspace.service.ts), client components
 * (WorkspaceProgressCard, WorkspaceCard, RadialFlameGraph, etc.), and sidebar
 * utilities (parseTaskStats).
 *
 * If you need to change how tasks are counted, filtered, or how statuses map
 * to progress categories — change it HERE, not in individual components.
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

/** Statuses excluded from progress totals entirely (neither done nor in-progress). */
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
// Canonical stats computation
// ---------------------------------------------------------------------------

export interface TaskStats {
  total: number;
  completed: number;
  inProgress: number;
}

/**
 * Compute progress stats from a flat list of notes.
 *
 * Delegates to {@link getSpecTaskNotes} for filtering, then counts statuses
 * using the shared status classification constants.
 */
export function computeTaskStats(notes: Note[]): TaskStats {
  const taskNotes = getSpecTaskNotes(notes);

  let total = 0;
  let completed = 0;
  let inProgress = 0;

  for (const note of taskNotes) {
    const status = note.metadata?.task?.status;
    if (status && EXCLUDED_STATUSES.has(status)) continue;
    total++;
    if (status === 'complete') {
      completed++;
    } else if (status && IN_PROGRESS_STATUSES.has(status)) {
      inProgress++;
    }
  }

  return { total, completed, inProgress };
}


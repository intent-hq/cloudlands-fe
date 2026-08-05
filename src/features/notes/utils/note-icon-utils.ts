import type { Note } from '$shared/types';
import { isSpecNote } from '$shared/constants/notes';
import {
  faStar,
  faCheckCircle,
  faCommentDots,
  faBell,
  faHourglassHalf,
  faBan,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';
import { faNote } from '$lib/icons/faNote';

/**
 * Get the appropriate icon for a note based on its type and status
 *
 * Task status icons:
 * - complete: checkmark (done)
 * - in_progress: comment dots (agent working)
 * - waiting: hourglass (waiting on dependencies)
 * - discussion_needed: bell (needs user attention)
 * - blocked: triangle exclamation (blocker needs user attention)
 * - review_required: bell (needs user attention)
 * - cancelled: ban (cancelled)
 * - not_started: default note icon
 */
export function getNoteIcon(note: Note) {
  if (isSpecNote(note.id)) return faStar;
  if (note.metadata?.task) {
    const status = note.metadata.task.status;
    if (status === 'complete') return faCheckCircle;
    if (status === 'in_progress') return faCommentDots;
    if (status === 'waiting') return faHourglassHalf;
    if (status === 'discussion_needed') return faBell;
    if (status === 'blocked') return faTriangleExclamation;
    if (status === 'review_required') return faBell;
    if (status === 'cancelled') return faBan;
  }
  return faNote;
}

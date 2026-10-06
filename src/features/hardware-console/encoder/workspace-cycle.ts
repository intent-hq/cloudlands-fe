/**
 * Pure ordering/cycling logic for the hardware encoder rotate behavior:
 * cycle the app's active workspace across workspaces ordered by activity
 * (lastActivity → createdAt → updatedAt), clamping at the list ends.
 *
 * Pure web code — no Electron imports, no store imports.
 */

import type { EncoderDirection } from '../input/types';
import {
  compareWorkspaceActivityDisplayTimeDesc,
  type WorkspaceActivityTimeFields,
} from '$shared/utils/workspace-activity-time';

/** The minimal workspace shape the encoder ordering needs. */
export interface EncoderCycleWorkspace extends WorkspaceActivityTimeFields {
  id: string;
}

/**
 * Workspaces in encoder-rotate cycling order: most recently active first
 * (activity ordering per `compareWorkspaceActivityDisplayTimeDesc`).
 */
export function orderWorkspacesForCycling<T extends EncoderCycleWorkspace>(
  workspaces: readonly T[],
): T[] {
  return workspaces.slice().sort(compareWorkspaceActivityDisplayTimeDesc);
}

/**
 * One encoder detent's cycling step. Returns the target workspace id, or
 * null when there is nowhere to go (empty list, or already at the end of
 * the list in the stepped direction — cycling clamps, it does not wrap).
 * Direction honored: cw steps toward more recently active, ccw toward less
 * recently active. An unknown/absent active id enters the list at the
 * direction-appropriate end.
 */
export function cycleWorkspaceId(
  orderedIds: readonly string[],
  activeWorkspaceId: string | null,
  direction: EncoderDirection,
): string | null {
  if (orderedIds.length === 0) return null;
  const step = direction === 'cw' ? -1 : 1;
  const index = activeWorkspaceId === null ? -1 : orderedIds.indexOf(activeWorkspaceId);
  if (index === -1) {
    return orderedIds[step === 1 ? 0 : orderedIds.length - 1];
  }
  const next = index + step;
  if (next < 0 || next >= orderedIds.length) return null;
  return orderedIds[next];
}

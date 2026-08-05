/**
 * Workspace-to-key assignment resolver for the 6 agent keys (AG00–AG05).
 *
 * Pins are a 6-slot array of workspace ids (null = unpinned;
 * {@link UNASSIGNED_KEY_PIN} = sticky-unassigned). Pinned slots are stable:
 * they always show their pinned workspace while it remains assignable.
 * Sticky-unassigned slots stay empty and are NEVER auto-filled. Unpinned
 * slots auto-fill with the most recently active assignable workspaces
 * (activity ordering per `compareWorkspaceActivityDisplayTimeDesc`:
 * lastActivity → createdAt → updatedAt fallback), skipping workspaces
 * already placed on a pinned slot and workspaces on the exclusion list —
 * so when an assigned workspace is archived/deleted its slot backfills
 * immediately with the next unslotted workspace.
 *
 * Assignments are STICKY: {@link reconcileKeyPins} promotes auto-filled
 * slots into pins so the persistence layer can write them back. Once a
 * workspace lands on a key it keeps that key regardless of later activity
 * changes; the slot is released only when the workspace stops being
 * assignable (archived/deleted). Manually unassigning a key puts its
 * workspace on the exclusion list so auto-fill never brings it back;
 * manually pinning a workspace clears it from the list.
 *
 * Slot numbering (binding): slots 1–4 (indexes 0–3) are the second row
 * (AG02–AG05, left→right); slots 5–6 (indexes 4–5) are the top row
 * (AG00, AG01).
 *
 * Pure web code — no Electron imports, no store imports.
 */

import type { AgentKeyId, LogicalKeyId } from '../input/types';
import {
  compareWorkspaceActivityDisplayTimeDesc,
  type WorkspaceActivityTimeFields,
} from '$shared/utils/workspace-activity-time';
import { WorkspaceStatus } from '$shared/types';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';

/** Number of physical agent keys (top two rows) on both supported devices. */
export const AGENT_KEY_COUNT = 6;

/**
 * Sticky-unassigned pin sentinel. A slot holding this value stays empty and
 * is never auto-filled. Workspace ids are UUIDs, so this cannot collide.
 */
export const UNASSIGNED_KEY_PIN = '__unassigned__';

/** One persisted pin entry: workspace id, sticky-unassigned, or auto-fill. */
export type KeyPin = string | null;

/**
 * Agent key ids in slot order. The binding numbering puts the second
 * physical row first: slot 0 = key "1" = AG02 … slot 3 = key "4" = AG05,
 * then the top row: slot 4 = key "5" = AG00, slot 5 = key "6" = AG01.
 */
export const AGENT_KEY_IDS: readonly AgentKeyId[] = [
  'AG02',
  'AG03',
  'AG04',
  'AG05',
  'AG00',
  'AG01',
];

/** Slot index (0-based) for a logical key, or null for non-agent keys. */
export function agentKeyToSlot(key: LogicalKeyId): number | null {
  const index = (AGENT_KEY_IDS as readonly string[]).indexOf(key);
  return index === -1 ? null : index;
}

/** The minimal workspace shape the resolver needs. */
export type KeyAssignableWorkspace = WorkspaceActivityTimeFields & { id: string };

/**
 * Whether a workspace may occupy an agent key: excludes the chief virtual
 * workspace and archived/deleted workspaces.
 */
export function isKeyAssignableWorkspace(workspace: {
  id: string;
  status?: WorkspaceStatus;
  archived?: boolean;
}): boolean {
  if (workspace.id === CHIEF_WORKSPACE_ID) return false;
  if (workspace.archived === true) return false;
  return (
    workspace.status !== WorkspaceStatus.Archived && workspace.status !== WorkspaceStatus.Deleted
  );
}

/**
 * Normalize an arbitrary persisted pins value to exactly 6 entries.
 * Preserves the sticky {@link UNASSIGNED_KEY_PIN} sentinel (backward
 * compatible: older pins arrays never contained it).
 */
export function normalizeKeyPins(pins: readonly (string | null)[] | undefined): KeyPin[] {
  const result: KeyPin[] = new Array(AGENT_KEY_COUNT).fill(null);
  if (!pins) return result;
  for (let slot = 0; slot < AGENT_KEY_COUNT; slot += 1) {
    const pin = pins[slot];
    if (typeof pin === 'string' && pin.length > 0) result[slot] = pin;
  }
  return result;
}

/**
 * Normalize a persisted excluded-workspace list: non-empty strings only
 * (the {@link UNASSIGNED_KEY_PIN} sentinel is rejected), deduplicated.
 * Tolerant of arbitrary persisted values (non-arrays yield an empty list).
 */
export function normalizeExcludedWorkspaceIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  const result: string[] = [];
  for (const id of ids) {
    if (
      typeof id === 'string' &&
      id.length > 0 &&
      id !== UNASSIGNED_KEY_PIN &&
      !result.includes(id)
    ) {
      result.push(id);
    }
  }
  return result;
}

/** Whether two 6-slot pin arrays hold identical entries. */
export function keyPinsEqual(
  a: readonly (string | null)[],
  b: readonly (string | null)[],
): boolean {
  for (let slot = 0; slot < AGENT_KEY_COUNT; slot += 1) {
    if ((a[slot] ?? null) !== (b[slot] ?? null)) return false;
  }
  return true;
}

/**
 * Resolve the 6 key slots to workspace ids (null = key unassigned).
 *
 * @param keyPins    6-slot pin array (tolerant of shorter/longer input).
 * @param workspaces Assignable workspaces (already filtered via
 *                   {@link isKeyAssignableWorkspace}); order irrelevant.
 * @param excludedWorkspaceIds Workspaces auto-fill must skip (manually
 *                   unassigned). Explicit pins still win over exclusion.
 *
 * Rules:
 * - A sticky-unassigned slot ({@link UNASSIGNED_KEY_PIN}) always resolves to
 *   null and is never auto-filled.
 * - A pinned slot shows its pinned workspace when that workspace is present;
 *   a pin referencing a missing workspace leaves the slot to auto-fill.
 * - A workspace pinned to several slots occupies only the lowest one.
 * - Remaining slots fill in ascending order with unplaced, non-excluded
 *   workspaces sorted by activity (most recent first), so every workspace
 *   has a slot whenever capacity allows.
 */
export function resolveKeySlots<T extends KeyAssignableWorkspace>(
  keyPins: readonly (string | null)[],
  workspaces: readonly T[],
  excludedWorkspaceIds: readonly string[] = [],
): (string | null)[] {
  const pins = normalizeKeyPins(keyPins);
  const byId = new Map<string, T>();
  for (const workspace of workspaces) byId.set(workspace.id, workspace);

  const slots: (string | null)[] = new Array(AGENT_KEY_COUNT).fill(null);
  const placed = new Set<string>();

  for (let slot = 0; slot < AGENT_KEY_COUNT; slot += 1) {
    const pin = pins[slot];
    if (pin !== null && pin !== UNASSIGNED_KEY_PIN && byId.has(pin) && !placed.has(pin)) {
      slots[slot] = pin;
      placed.add(pin);
    }
  }

  const excluded = new Set(excludedWorkspaceIds);
  const remaining = workspaces
    .filter((workspace) => !placed.has(workspace.id) && !excluded.has(workspace.id))
    .slice()
    .sort(compareWorkspaceActivityDisplayTimeDesc);

  let nextIndex = 0;
  for (let slot = 0; slot < AGENT_KEY_COUNT && nextIndex < remaining.length; slot += 1) {
    if (slots[slot] !== null || pins[slot] === UNASSIGNED_KEY_PIN) continue;
    slots[slot] = remaining[nextIndex].id;
    nextIndex += 1;
  }

  return slots;
}

/**
 * Reconcile the pin array against the current workspaces: the sticky
 * write-back form of {@link resolveKeySlots}. Auto-filled slots are
 * promoted into pins (so assignments survive activity changes), pins whose
 * workspace is gone are released (and backfilled by the resolver), and
 * sticky-unassigned slots keep their sentinel. Persisting the returned
 * array is what makes assignments sticky; on first run it snapshots the
 * previously activity-derived layout into persisted assignments.
 */
export function reconcileKeyPins<T extends KeyAssignableWorkspace>(
  keyPins: readonly (string | null)[],
  workspaces: readonly T[],
  excludedWorkspaceIds: readonly string[] = [],
): KeyPin[] {
  const pins = normalizeKeyPins(keyPins);
  const resolved = resolveKeySlots(keyPins, workspaces, excludedWorkspaceIds);
  return pins.map((pin, slot) => (pin === UNASSIGNED_KEY_PIN ? UNASSIGNED_KEY_PIN : resolved[slot]));
}

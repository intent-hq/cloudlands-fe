/**
 * Pure stepping logic for the encoder's Switch tabs mode: move across
 * the visible workspace tabs in their on-screen order, clamping at the ends.
 *
 * Pure web code — no Electron imports, no store imports.
 */

import type { PhysicalKnobDirection } from '../input/types';
import type { WorkspaceTabGroup } from '$store/renderer/slices/tab-state/tab-groups';

/**
 * The tabs the strip shows: members of a collapsed group are hidden behind
 * its chip, so only ungrouped tabs and the open group's members remain.
 */
export function visibleWorkspaceTabs(
  tabOrder: readonly string[],
  groups: readonly WorkspaceTabGroup[],
  openGroupId: string | null,
): string[] {
  const hidden = new Set(
    groups.filter((group) => group.id !== openGroupId).flatMap((group) => group.workspaceIds),
  );
  return tabOrder.filter((id) => !hidden.has(id));
}

/**
 * One detent across the tab strip. Clockwise moves one tab right,
 * counter-clockwise one tab left. Returns null at either end (no wrap) or
 * with no tabs. From outside the strip (Home, Settings, an unknown id),
 * clockwise enters at the leftmost tab and counter-clockwise at the rightmost.
 */
export function stepWorkspaceTab(
  tabOrder: readonly string[],
  currentWorkspaceId: string | null,
  direction: PhysicalKnobDirection,
): string | null {
  if (tabOrder.length === 0) return null;
  const step = direction === 'clockwise' ? 1 : -1;
  const index = currentWorkspaceId === null ? -1 : tabOrder.indexOf(currentWorkspaceId);
  if (index === -1) return tabOrder[step === 1 ? 0 : tabOrder.length - 1];
  return tabOrder[index + step] ?? null;
}

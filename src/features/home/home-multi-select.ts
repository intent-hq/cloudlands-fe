import { isCmdClickModifier } from '$shared/utils/link-helpers';
import { isPlainFolderWorkspace } from '$lib/utils/plain-folder-workspace';
import { WorkspaceStatusEnum, type Workspace } from '$shared/types';

/**
 * Home selection: `selectedId` is the single previewed row; `multi` holds two or
 * more rows picked with Cmd/Ctrl-click. Only one of the two is ever in use.
 */
export interface HomeSelection {
  multi: readonly string[];
  selectedId: string | null;
}

/** Cmd/Ctrl-click on `id`. */
export function toggleHomeSelection(selection: HomeSelection, id: string): HomeSelection {
  const current =
    selection.multi.length > 0
      ? [...selection.multi]
      : selection.selectedId
        ? [selection.selectedId]
        : [];
  const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
  if (next.length < 2) return { multi: [], selectedId: next[0] ?? null };
  return { multi: next, selectedId: null };
}

/** Shift-click on `id`: every row from `anchor` to `id`, in screen `order`. */
export function rangeHomeSelection(
  order: readonly string[],
  anchor: string | null,
  id: string,
): HomeSelection {
  const from = anchor === null ? -1 : order.indexOf(anchor);
  const to = order.indexOf(id);
  if (from < 0 || to < 0 || from === to) return { multi: [], selectedId: id };
  return { multi: order.slice(Math.min(from, to), Math.max(from, to) + 1), selectedId: null };
}

function isNestedControl(event: MouseEvent): boolean {
  const control =
    event.target instanceof Element
      ? event.target.closest(
          'button, a, input, select, textarea, [role="button"], [role="menuitem"]',
        )
      : null;
  return Boolean(control && control !== event.currentTarget);
}

/** A primary click on the row itself, not on a control inside it. */
export function isHomeRowClick(event: MouseEvent): boolean {
  return event.button === 0 && !isNestedControl(event);
}

/** A primary Cmd/Ctrl-click on the row itself. */
export function isHomeSelectionToggle(event: MouseEvent): boolean {
  if (!isCmdClickModifier({ event }) || event.shiftKey || event.altKey) return false;
  return isHomeRowClick(event);
}

/** A primary Shift-click on the row itself; also used to stop the text selection it starts. */
export function isHomeRangeClick(event: MouseEvent): boolean {
  if (!event.shiftKey || event.altKey || isCmdClickModifier({ event })) return false;
  return isHomeRowClick(event);
}

export interface HomeBulkTargets {
  archive: Workspace[];
  purge: Workspace[];
  delete: Workspace[];
  transfer: Workspace[];
}

/** The selected workspaces each bulk action applies to; `canManage` gates owner actions. */
export function homeBulkTargets(
  workspaces: readonly Workspace[],
  canManage: (workspace: Workspace) => boolean,
): HomeBulkTargets {
  const managed = workspaces.filter(canManage);
  return {
    archive: managed.filter(
      (workspace) =>
        workspace.status !== WorkspaceStatusEnum.Archived &&
        workspace.status !== WorkspaceStatusEnum.Retired,
    ),
    purge: managed.filter((workspace) => workspace.status === WorkspaceStatusEnum.Archived),
    delete: managed,
    // Purged workspaces have no folder to export; plain folders have no git to bundle.
    transfer: managed.filter(
      (workspace) =>
        workspace.status !== WorkspaceStatusEnum.Retired && !isPlainFolderWorkspace(workspace),
    ),
  };
}

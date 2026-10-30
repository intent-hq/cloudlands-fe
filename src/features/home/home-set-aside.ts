import type { Workspace } from '$shared/types';
import { m } from '$shared/paraglide/messages.js';
import { store } from '$store/renderer/store';
import { reversibleActions } from '$lib/utils/reversible-actions';
import { notify } from '$lib/components/patterns/notify';
import { bringBackHomeWorkspace, setHomeWorkspaceAside } from './home-workspaces-slice';
import {
  selectHomePersistenceScope,
  selectHomeSetAsideRecords,
  selectHomeWorkspaceIsSetAside,
} from './home-workspaces-selectors';

/** Group key for the Home "Set aside" shelf in `expandedGroups`; collapsed unless `true`. */
export const HOME_SET_ASIDE_GROUP = 'home:set-aside';

const UNDO_SECONDS = 8;

/**
 * Move a workspace into the personal Set aside shelf with an Undo toast.
 * This only changes Home organization: agents, hooks and watches keep running.
 */
export function setHomeWorkspaceAsideWithUndo(workspace: Workspace): void {
  const title = workspace.title.trim() || m.workspace_links_untitled_label();
  const scope = selectHomePersistenceScope.select(store.state);
  const at = Date.now();
  void reversibleActions.execute({
    id: `home-set-aside:${workspace.id}:${globalThis.crypto.randomUUID()}`,
    message: m.home_setAside_toast_message({ title }),
    action: () => {
      store.dispatch(setHomeWorkspaceAside(workspace.id, at));
      if (selectHomeWorkspaceIsSetAside.select(store.state, workspace.id)) return true;
      // The bounded record set refused it; the row stays active, so offer no Undo.
      notify.warning(m.home_setAside_full_error());
      return false;
    },
    onUndo: () => {
      if (
        selectHomePersistenceScope.select(store.state) !== scope ||
        selectHomeSetAsideRecords.select(store.state)[workspace.id]?.at !== at
      )
        return;
      store.dispatch(bringBackHomeWorkspace(workspace.id));
    },
    duration: UNDO_SECONDS,
  });
}

export function bringBackHomeWorkspaceNow(workspaceId: string): void {
  store.dispatch(bringBackHomeWorkspace(workspaceId));
}

/**
 * The workspace that should take focus when `workspaceId` leaves its current list:
 * the next row in the same list, else the previous one.
 */
export function neighborHomeWorkspaceId(
  homeElement: HTMLElement | null,
  workspaceId: string,
): string | null {
  const current = homeElement?.querySelector<HTMLElement>(
    `[data-home-workspace="${CSS.escape(workspaceId)}"]`,
  );
  const list = current?.closest<HTMLElement>('[data-home-workspace-list], [role="listbox"]');
  if (!current || !list) return null;
  const ids = [...list.querySelectorAll<HTMLElement>('[data-home-workspace]')]
    .map((node) => node.dataset.homeWorkspace)
    .filter((id): id is string => !!id);
  const index = ids.indexOf(workspaceId);
  return ids[index + 1] ?? ids[index - 1] ?? null;
}

/**
 * Keep keyboard focus in place after a row moves between the active list and the shelf:
 * if focus was lost with the moved row, land on its old neighbor or the shelf toggle.
 */
export function restoreHomeFocusAfterMove(
  getHomeElement: () => HTMLElement | null,
  neighborId: string | null,
): void {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return;
      const home = getHomeElement();
      const row = neighborId
        ? home
            ?.querySelector<HTMLElement>(`[data-home-workspace="${CSS.escape(neighborId)}"]`)
            ?.closest<HTMLElement>('[role="option"], button')
        : null;
      (row ?? home?.querySelector<HTMLElement>('[data-home-set-aside-toggle]'))?.focus();
    }),
  );
}

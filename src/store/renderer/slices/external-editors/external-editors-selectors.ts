import { store } from '../../store';
import {
  createInstalledEditorsProjection,
  getInstalledEditorsCollection,
  getInstalledEditorsLoading,
  getLastFetched,
} from './external-editors-projections';
import { selectIsDaemonLocal } from '../daemon-health/daemon-health-selectors';
import { selectIsWorkspaceHostLocal } from '../workspace/workspace-selectors';
import type { InstalledEditor, OpenAction } from './external-editors-slice';

/** Select the selected open action */
export const selectOpenAction = store.createSelector((state): OpenAction => {
  return state.externalEditors.selectedAction;
});

/** Select installed editors collection */
const selectInstalledEditorsCollection = store.createSelector(getInstalledEditorsCollection);

/** Select all installed editors */
export const selectInstalledEditors = store.createSelector(
  createInstalledEditorsProjection(selectInstalledEditorsCollection),
);

export const selectEditorOrder = store.createSelector(
  (state): string[] => state.externalEditors.editorOrder ?? [],
);

/** Select loading state */
export const selectInstalledEditorsLoading = store.createSelector(getInstalledEditorsLoading);

/** Select the last fetched timestamp */
export const selectLastFetched = store.createSelector(getLastFetched);

/** Select editor IDs hidden from Open In menus */
export const selectHiddenEditorIds = store.createSelector((state): string[] => {
  return state.externalEditors.hiddenEditorIds;
});

/**
 * Select editors where installed === true and not hidden.
 *
 * Locality-gated: `host.listInstalledEditors` detects editors on the DAEMON
 * host, and every open action (host.openInEditor / shell:showItemInFolder →
 * host.exec) launches a GUI there — meaningless when the daemon is remote.
 * Remote connections get an empty list, so the "Open in…" / "Reveal in…"
 * affordances disappear instead of no-oping on another machine.
 *
 * When a `workspaceId` is supplied the gate tightens to workspace locality
 * (`selectIsWorkspaceHostLocal`, monorepo#2171): a remote (SSH) workspace has
 * no files on the local desktop even when the daemon is local, so editor
 * opens against its paths must be hidden too. Without a `workspaceId` the
 * gate falls back to daemon locality (`selectIsDaemonLocal`), keeping this
 * gate and the per-component reveal gates from drifting apart.
 */
export const selectInstalledEditorsFiltered = store.createSelector<
  [workspaceId?: string],
  InstalledEditor[]
>((state, workspaceId): InstalledEditor[] => {
  const isLocal = workspaceId
    ? selectIsWorkspaceHostLocal.select(state, workspaceId)
    : selectIsDaemonLocal.select(state);
  if (!isLocal) return [];
  const hiddenEditorIds = selectHiddenEditorIds.select(state);
  return selectInstalledEditors
    .select(state)
    .filter((editor) => editor.installed && !hiddenEditorIds.includes(editor.id));
});

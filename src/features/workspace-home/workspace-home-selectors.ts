import { store } from '$store/renderer/store';
import {
  selectCanManageWorkspace,
  selectWorkspaceById,
} from '$store/renderer/slices/workspace/workspace-selectors';
import { selectAllWorkspaceAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
import { selectStartOnRows } from '$features/remote-machines/remote-machines-selectors';
import type { WorkspaceHome } from '$shared/types/workspace-home';
import {
  moveHomeTargets,
  workspaceHomeView,
  type MoveHomeOption,
  type WorkspaceHomeView,
} from './workspace-home';

// Selector readables emit on every new reference, so derived values are
// cached: a view per served home object, and the last equal option list.
const viewsByHome = new WeakMap<WorkspaceHome, WorkspaceHomeView>();

/** The workspace's home as the UI shows it; null when it has none (homes are gated). */
export const selectWorkspaceHomeView = store.createSelector(
  (state, workspaceId: string): WorkspaceHomeView | null => {
    const home = selectWorkspaceById.select(state, workspaceId)?.home;
    if (!home) return null;
    let view = viewsByHome.get(home);
    if (!view) {
      view = workspaceHomeView({ home })!;
      viewsByHome.set(home, view);
    }
    return view;
  },
);

/** Owners and managers may move the home while no move is running. */
export const selectCanMoveWorkspaceHome = store.createSelector(
  (state, workspaceId: string) =>
    selectWorkspaceHomeView.select(state, workspaceId)?.canMove === true &&
    selectCanManageWorkspace.select(state, workspaceId),
);

/** A Wait retry is in flight for the workspace. */
export const selectHomeWaiting = store.createSelector(
  (state, workspaceId: string) => state.workspaceHome.waiting[workspaceId] === true,
);

/** The Move home dialog's workspace, or null while it is closed. */
export const selectMoveHomeDialogWorkspaceId = store.createSelector(
  (state) => state.workspaceHome.dialogWorkspaceId,
);

/** A `workspace.setHome` call is in flight. */
export const selectMoveHomeSubmitting = store.createSelector(
  (state) => state.workspaceHome.moveStatus === 'submitting',
);

/** The last `workspace.setHome` refusal while the dialog is open. */
export const selectMoveHomeFailure = store.createSelector(
  (state) => state.workspaceHome.moveFailure,
);

let lastOptions: { key: string; options: MoveHomeOption[] } | null = null;

/** Where the home can move: the workspace's agents on a live machine, then the machine list. */
export const selectMoveHomeOptions = store.createSelector(
  (state, workspaceId: string): MoveHomeOption[] => {
    if (!workspaceId) return [];
    const options = moveHomeTargets({
      agents: selectAllWorkspaceAgents.select(state, workspaceId),
      machineRows: selectStartOnRows.select(state),
    });
    const key = JSON.stringify(options);
    if (lastOptions?.key !== key) lastOptions = { key, options };
    return lastOptions.options;
  },
);

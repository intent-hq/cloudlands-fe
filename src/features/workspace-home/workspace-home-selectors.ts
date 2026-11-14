import { store } from '$store/renderer/store';
import {
  selectCanManageWorkspace,
  selectWorkspaceById,
} from '$store/renderer/slices/workspace/workspace-selectors';
import { selectAllWorkspaceAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
import { selectStartOnRows } from '$features/remote-machines/remote-machines-selectors';
import { moveHomeTargets, workspaceHomeView, type MoveHomeOption } from './workspace-home';

/** The workspace's home as the UI shows it; null when it has none (homes are gated). */
export const selectWorkspaceHomeView = store.createSelector((state, workspaceId: string) =>
  workspaceHomeView(selectWorkspaceById.select(state, workspaceId)),
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

/** The Move home dialog: its workspace, the call in flight and the last refusal. */
export const selectMoveHomeDialog = store.createSelector((state) => {
  const { dialogWorkspaceId, moveStatus, moveFailure } = state.workspaceHome;
  return { workspaceId: dialogWorkspaceId, submitting: moveStatus === 'submitting', moveFailure };
});

/** Where the home can move: the workspace's agents on a live machine, then the machine list. */
export const selectMoveHomeOptions = store.createSelector(
  (state, workspaceId: string): MoveHomeOption[] =>
    moveHomeTargets({
      agents: selectAllWorkspaceAgents.select(state, workspaceId),
      machineRows: selectStartOnRows.select(state),
    }),
);

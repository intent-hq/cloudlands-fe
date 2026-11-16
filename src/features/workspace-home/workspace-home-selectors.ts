import { store } from '$store/renderer/store';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import type { Workspace } from '$shared/types';
import { selectHidesOwnerWorkspaceActions } from '$store/renderer/slices/workspace/workspace-selectors';
import { selectAllWorkspaceAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
import { selectStartOnRows } from '$features/remote-machines/remote-machines-selectors';
import type { WorkspaceHome } from '$shared/types/workspace-home';
import {
  moveHomeMenuVisible,
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
    const workspace = getItem(state.workspace.workspaces, workspaceId as Workspace['id']);
    const home = workspace?.home;
    if (!home) return null;
    const cached = viewsByHome.get(home);
    if (cached) return cached;
    const view = workspaceHomeView(workspace);
    if (view) viewsByHome.set(home, view);
    return view;
  },
);

/**
 * Owners and managers may move the home while no move is running (see
 * `moveHomeMenuVisible`). Same management gate as the workspace menu's
 * Transfer and Share, so the menu, banner and panels agree.
 */
export const selectCanMoveWorkspaceHome = store.createSelector((state, workspaceId: string) =>
  moveHomeMenuVisible(
    getItem(state.workspace.workspaces, workspaceId as Workspace['id']),
    !selectHidesOwnerWorkspaceActions.select(state, workspaceId),
  ),
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

const NO_OPTIONS: MoveHomeOption[] = [];
const lastOptionsByWorkspace = new Map<string, { key: string; options: MoveHomeOption[] }>();

/** Where the home can move: the workspace's agents on a live machine, then the machine list. */
export const selectMoveHomeOptions = store.createSelector(
  (state, workspaceId: string): MoveHomeOption[] => {
    if (!workspaceId) return NO_OPTIONS;
    const options = moveHomeTargets({
      agents: selectAllWorkspaceAgents.select(state, workspaceId),
      machineRows: selectStartOnRows.select(state),
    });
    // Only the open dialog subscribes, so this runs for one workspace at a time.
    const key = JSON.stringify(options);
    const last = lastOptionsByWorkspace.get(workspaceId);
    if (last?.key === key) return last.options;
    lastOptionsByWorkspace.set(workspaceId, { key, options });
    return options;
  },
);

/** The workspace's row is in the store (a panel's home retry waits for it). */
export const selectWorkspaceRowLoaded = store.createSelector(
  (state, workspaceId: string) =>
    getItem(state.workspace.workspaces, workspaceId as Workspace['id']) !== undefined,
);

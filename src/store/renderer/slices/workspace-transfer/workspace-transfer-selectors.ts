/**
 * Workspace Transfer Selectors
 */

import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import { store } from '../../store';
import type { ConnectionRecord } from '../connections/connections-types';

export const selectTransferModalOpen = store.createSelector(
  (state) => state.workspaceTransfer.open,
);

export const selectTransferWorkspaceId = store.createSelector(
  (state) => state.workspaceTransfer.workspaceId,
);

export const selectTransferWorkspaceTitle = store.createSelector(
  (state) => state.workspaceTransfer.workspaceTitle,
);

export const selectTransferStep = store.createSelector((state) => state.workspaceTransfer.step);

export const selectTransferDestinationValue = store.createSelector(
  (state) => state.workspaceTransfer.destination,
);

export const selectTransferPlanStatus = store.createSelector(
  (state) => state.workspaceTransfer.planStatus,
);

export const selectTransferPlan = store.createSelector((state) => state.workspaceTransfer.plan);

export const selectTransferPlanError = store.createSelector(
  (state) => state.workspaceTransfer.planError,
);

/**
 * Connections eligible as transfer targets: the connections list minus the
 * currently-active backend (the source). When a remote is active this includes
 * the local entry; when local is active it is excluded by the activeId check,
 * leaving only remotes (unchanged behavior).
 */
export const selectTransferTargetConnections = store.createSelector(
  (state): ConnectionRecord[] => {
    const { connections, activeId } = state.connections;
    return getItems(connections).filter((c) => c.id !== activeId);
  },
);

export const selectTransferRunStatus = store.createSelector(
  (state) => state.workspaceTransfer.runStatus,
);

export const selectTransferProgress = store.createSelector(
  (state) => state.workspaceTransfer.progress,
);

export const selectTransferRunError = store.createSelector(
  (state) => state.workspaceTransfer.runError,
);

export const selectTransferRestartAgents = store.createSelector(
  (state) => state.workspaceTransfer.restartAgents,
);

export const selectTransferDownloadFilePath = store.createSelector(
  (state) => state.workspaceTransfer.downloadFilePath,
);

export const selectTransferInterruptedAgents = store.createSelector(
  (state) => state.workspaceTransfer.interruptedAgents,
);

export const selectTransferArchiveSource = store.createSelector(
  (state) => state.workspaceTransfer.archiveSource,
);

export const selectTransferFinalizeStatus = store.createSelector(
  (state) => state.workspaceTransfer.finalizeStatus,
);

export const selectTransferFinalizeError = store.createSelector(
  (state) => state.workspaceTransfer.finalizeError,
);

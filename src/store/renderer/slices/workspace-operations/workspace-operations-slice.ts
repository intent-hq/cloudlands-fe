import { createAction } from "@augmentcode/themis/utils/store/create-action";
import { createReducer } from "@augmentcode/themis/utils/store/create-reducer";
import type { WorkspaceProposalApplyPayload } from "$shared/app-workspace-operations";

export type WorkspaceOperationsState = {
  showDeleteWarning: boolean;
  pendingDeleteWorkspaceId: string | null;
  runningAgentNamesForDelete: string[];
  activeHookNamesForDelete: string[];
  showArchiveWarning: boolean;
  pendingArchiveWorkspaceId: string | null;
  runningAgentNamesForArchive: string[];
  activeHookNamesForArchive: string[];
  showBulkArchiveConfirm: boolean;
  bulkArchiveActiveAgentCount: number;
  bulkArchiveActiveHookCount: number;
  /** Monotonic token; only the compute matching the latest open folds its counts. */
  bulkArchiveComputeToken: number;
  showBulkDeleteArchivedConfirm: boolean;
  pendingBulkRepoKey: string | undefined;
  pendingBulkDeleteRepoKey: string | null;
  showBulkDeleteWarningConfirm: boolean;
  bulkDeleteWorkspaceCount: number;
  bulkDeleteActiveAgentCount: number;
  bulkDeleteActiveHookCount: number;
  showRemoveRepoConfirm: boolean;
  pendingRemoveRepoPath: string | null;
};

export const initialState: WorkspaceOperationsState = {
  showDeleteWarning: false,
  pendingDeleteWorkspaceId: null,
  runningAgentNamesForDelete: [],
  activeHookNamesForDelete: [],
  showArchiveWarning: false,
  pendingArchiveWorkspaceId: null,
  runningAgentNamesForArchive: [],
  activeHookNamesForArchive: [],
  showBulkArchiveConfirm: false,
  bulkArchiveActiveAgentCount: 0,
  bulkArchiveActiveHookCount: 0,
  bulkArchiveComputeToken: 0,
  showBulkDeleteArchivedConfirm: false,
  pendingBulkRepoKey: undefined,
  pendingBulkDeleteRepoKey: null,
  showBulkDeleteWarningConfirm: false,
  bulkDeleteWorkspaceCount: 0,
  bulkDeleteActiveAgentCount: 0,
  bulkDeleteActiveHookCount: 0,
  showRemoveRepoConfirm: false,
  pendingRemoveRepoPath: null,
};

export const requestDeleteWorkspace = createAction<[workspaceId: string]>(
  "workspaceOperations/requestDeleteWorkspace"
);

export const confirmDeleteWorkspace = createAction(
  "workspaceOperations/confirmDeleteWorkspace"
);

export const requestArchiveWorkspace = createAction<[workspaceId: string]>(
  "workspaceOperations/requestArchiveWorkspace"
);

export const applyWorkspaceProposal = createAction<[payload: WorkspaceProposalApplyPayload]>(
  "workspaceOperations/applyWorkspaceProposal"
);

export const openDeleteWarning = createAction<
  [payload: { workspaceId: string; agentNames: string[]; hookNames: string[] }]
>("workspaceOperations/openDeleteWarning");

export const closeDeleteWarning = createAction("workspaceOperations/closeDeleteWarning");

export const openArchiveWarning = createAction<
  [payload: { workspaceId: string; agentNames: string[]; hookNames: string[] }]
>("workspaceOperations/openArchiveWarning");

export const closeArchiveWarning = createAction("workspaceOperations/closeArchiveWarning");

export const confirmArchiveWorkspace = createAction(
  "workspaceOperations/confirmArchiveWorkspace"
);

export const workspaceOperationsReducer = createReducer<WorkspaceOperationsState>(initialState);
workspaceOperationsReducer.with(openDeleteWarning, (state, { payload: [{ workspaceId, agentNames, hookNames }] }) => ({
    ...state,
    showDeleteWarning: true,
    pendingDeleteWorkspaceId: workspaceId,
    runningAgentNamesForDelete: agentNames,
    activeHookNamesForDelete: hookNames,
  }));
workspaceOperationsReducer.with(closeDeleteWarning, (state) => ({
    ...state,
    showDeleteWarning: false,
    pendingDeleteWorkspaceId: null,
    runningAgentNamesForDelete: [],
    activeHookNamesForDelete: [],
  }));
workspaceOperationsReducer.with(openArchiveWarning, (state, { payload: [{ workspaceId, agentNames, hookNames }] }) => ({
    ...state,
    showArchiveWarning: true,
    pendingArchiveWorkspaceId: workspaceId,
    runningAgentNamesForArchive: agentNames,
    activeHookNamesForArchive: hookNames,
  }));
workspaceOperationsReducer.with(closeArchiveWarning, (state) => ({
    ...state,
    showArchiveWarning: false,
    pendingArchiveWorkspaceId: null,
    runningAgentNamesForArchive: [],
    activeHookNamesForArchive: [],
  }));
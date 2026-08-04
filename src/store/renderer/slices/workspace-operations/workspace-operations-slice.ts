import { createAction } from "$lib/store-shim/utils/store/create-action";
import { createReducer } from "$lib/store-shim/utils/store/create-reducer";
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
  showBulkDeleteArchivedConfirm: boolean;
  pendingBulkRepoKey: string | undefined;
  pendingBulkDeleteRepoKey: string | null;
  showBulkDeleteWarningConfirm: boolean;
  bulkDeleteWorkspaceCount: number;
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
  showBulkDeleteArchivedConfirm: false,
  pendingBulkRepoKey: undefined,
  pendingBulkDeleteRepoKey: null,
  showBulkDeleteWarningConfirm: false,
  bulkDeleteWorkspaceCount: 0,
  showRemoveRepoConfirm: false,
  pendingRemoveRepoPath: null,
};

export const requestOpenWorkspace = createAction<
  [payload: { workspaceId: string; openInNewWindow: boolean }]
>("workspaceOperations/requestOpenWorkspace");

export const requestDeleteWorkspace = createAction<[workspaceId: string]>(
  "workspaceOperations/requestDeleteWorkspace"
);

export const confirmDeleteWorkspace = createAction(
  "workspaceOperations/confirmDeleteWorkspace"
);

export const requestArchiveWorkspace = createAction<[workspaceId: string]>(
  "workspaceOperations/requestArchiveWorkspace"
);

export const requestUnarchiveWorkspace = createAction<[workspaceId: string]>(
  "workspaceOperations/requestUnarchiveWorkspace"
);

export const requestBulkArchiveWorkspaces = createAction<[workspaceIds: string[]]>(
  "workspaceOperations/requestBulkArchiveWorkspaces"
);

export const requestBulkDeleteWorkspaces = createAction<[workspaceIds: string[]]>(
  "workspaceOperations/requestBulkDeleteWorkspaces"
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

export const openBulkArchiveConfirm = createAction<[repoKey: string]>(
  "workspaceOperations/openBulkArchiveConfirm"
);

export const closeBulkArchiveConfirm = createAction(
  "workspaceOperations/closeBulkArchiveConfirm"
);

export const confirmBulkArchive = createAction("workspaceOperations/confirmBulkArchive");

export const openBulkDeleteArchivedConfirm = createAction<[repoKey: string]>(
  "workspaceOperations/openBulkDeleteArchivedConfirm"
);

export const closeBulkDeleteArchivedConfirm = createAction(
  "workspaceOperations/closeBulkDeleteArchivedConfirm"
);

export const confirmBulkDeleteArchived = createAction(
  "workspaceOperations/confirmBulkDeleteArchived"
);

export const openBulkDeleteWarningConfirm = createAction<
  [payload: { repoKey: string; workspaceCount: number }]
>("workspaceOperations/openBulkDeleteWarningConfirm");

export const closeBulkDeleteWarningConfirm = createAction(
  "workspaceOperations/closeBulkDeleteWarningConfirm"
);

export const confirmBulkDeleteWarning = createAction(
  "workspaceOperations/confirmBulkDeleteWarning"
);

export const openRemoveRepoConfirm = createAction<[repoPath: string]>(
  "workspaceOperations/openRemoveRepoConfirm"
);

export const closeRemoveRepoConfirm = createAction(
  "workspaceOperations/closeRemoveRepoConfirm"
);

export const confirmRemoveRepo = createAction("workspaceOperations/confirmRemoveRepo");

export const workspaceOperationsReducer = createReducer<WorkspaceOperationsState>(initialState)
  .with(openDeleteWarning, (state, { payload: [{ workspaceId, agentNames, hookNames }] }) => ({
    ...state,
    showDeleteWarning: true,
    pendingDeleteWorkspaceId: workspaceId,
    runningAgentNamesForDelete: agentNames,
    activeHookNamesForDelete: hookNames,
  }))
  .with(closeDeleteWarning, (state) => ({
    ...state,
    showDeleteWarning: false,
    pendingDeleteWorkspaceId: null,
    runningAgentNamesForDelete: [],
    activeHookNamesForDelete: [],
  }))
  .with(openArchiveWarning, (state, { payload: [{ workspaceId, agentNames, hookNames }] }) => ({
    ...state,
    showArchiveWarning: true,
    pendingArchiveWorkspaceId: workspaceId,
    runningAgentNamesForArchive: agentNames,
    activeHookNamesForArchive: hookNames,
  }))
  .with(closeArchiveWarning, (state) => ({
    ...state,
    showArchiveWarning: false,
    pendingArchiveWorkspaceId: null,
    runningAgentNamesForArchive: [],
    activeHookNamesForArchive: [],
  }))
  .with(openBulkArchiveConfirm, (state, { payload: [repoKey] }) => ({
    ...state,
    showBulkArchiveConfirm: true,
    pendingBulkRepoKey: repoKey,
  }))
  .with(closeBulkArchiveConfirm, (state) => ({
    ...state,
    showBulkArchiveConfirm: false,
    pendingBulkRepoKey: undefined,
  }))
  .with(openBulkDeleteArchivedConfirm, (state, { payload: [repoKey] }) => ({
    ...state,
    showBulkDeleteArchivedConfirm: true,
    pendingBulkRepoKey: repoKey,
  }))
  .with(closeBulkDeleteArchivedConfirm, (state) => ({
    ...state,
    showBulkDeleteArchivedConfirm: false,
    pendingBulkRepoKey: undefined,
  }))
  .with(
    openBulkDeleteWarningConfirm,
    (state, { payload: [{ repoKey, workspaceCount }] }) => ({
      ...state,
      showBulkDeleteWarningConfirm: true,
      pendingBulkDeleteRepoKey: repoKey,
      bulkDeleteWorkspaceCount: workspaceCount,
    })
  )
  .with(closeBulkDeleteWarningConfirm, (state) => ({
    ...state,
    showBulkDeleteWarningConfirm: false,
    pendingBulkDeleteRepoKey: null,
    bulkDeleteWorkspaceCount: 0,
  }))
  .with(openRemoveRepoConfirm, (state, { payload: [repoPath] }) => ({
    ...state,
    showRemoveRepoConfirm: true,
    pendingRemoveRepoPath: repoPath,
  }))
  .with(closeRemoveRepoConfirm, (state) => ({
    ...state,
    showRemoveRepoConfirm: false,
    pendingRemoveRepoPath: null,
  }));
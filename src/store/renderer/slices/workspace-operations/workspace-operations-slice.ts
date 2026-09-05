import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import {
  createCollection,
  type Collection,
} from '@augmentcode/themis/utils/collections/collection-utils';
import type { WorkspaceProposalApplyPayload } from '$shared/app-workspace-operations';
import type { LocalChangesWarning, OpenPrWarningItem } from './workspace-operations-types';

export type WorkspaceOperationsState = {
  showDeleteWarning: boolean;
  pendingDeleteWorkspaceId: string | null;
  runningAgentNamesForDelete: string[];
  activeHookNamesForDelete: string[];
  openPrsForDelete: Collection<OpenPrWarningItem, 'number'>;
  /** `null` when the warning has no local-changes data (RPC failed or not fetched). */
  localChangesForDelete: LocalChangesWarning | null;
  showArchiveWarning: boolean;
  pendingArchiveWorkspaceId: string | null;
  runningAgentNamesForArchive: string[];
  activeHookNamesForArchive: string[];
  openPrsForArchive: Collection<OpenPrWarningItem, 'number'>;
  localChangesForArchive: LocalChangesWarning | null;
  showBulkArchiveConfirm: boolean;
  showBulkDeleteConfirm: boolean;
  pendingBulkWorkspaceIds: string[];
  pendingBulkGroupLabel: string | null;
  bulkActiveAgentCount: number;
  bulkActiveHookCount: number;
  /** Monotonic token; only the compute matching the latest open folds its counts. */
  bulkComputeToken: number;
  showRemoveRepoConfirm: boolean;
  pendingRemoveRepoPath: string | null;
};

const emptyOpenPrs = () => createCollection<OpenPrWarningItem, 'number'>('number');

export const initialState: WorkspaceOperationsState = {
  showDeleteWarning: false,
  pendingDeleteWorkspaceId: null,
  runningAgentNamesForDelete: [],
  activeHookNamesForDelete: [],
  openPrsForDelete: emptyOpenPrs(),
  localChangesForDelete: null,
  showArchiveWarning: false,
  pendingArchiveWorkspaceId: null,
  runningAgentNamesForArchive: [],
  activeHookNamesForArchive: [],
  openPrsForArchive: emptyOpenPrs(),
  localChangesForArchive: null,
  showBulkArchiveConfirm: false,
  showBulkDeleteConfirm: false,
  pendingBulkWorkspaceIds: [],
  pendingBulkGroupLabel: null,
  bulkActiveAgentCount: 0,
  bulkActiveHookCount: 0,
  bulkComputeToken: 0,
  showRemoveRepoConfirm: false,
  pendingRemoveRepoPath: null,
};

export const requestDeleteWorkspace = createAction<[workspaceId: string]>(
  'workspaceOperations/requestDeleteWorkspace',
);

export const confirmDeleteWorkspace = createAction('workspaceOperations/confirmDeleteWorkspace');

export const requestArchiveWorkspace = createAction<[workspaceId: string]>(
  'workspaceOperations/requestArchiveWorkspace',
);

export const requestUnarchiveWorkspace = createAction<[workspaceId: string]>(
  'workspaceOperations/requestUnarchiveWorkspace',
);

export const applyWorkspaceProposal = createAction<[payload: WorkspaceProposalApplyPayload]>(
  'workspaceOperations/applyWorkspaceProposal',
);

export const openDeleteWarning = createAction<
  [
    payload: {
      workspaceId: string;
      agentNames: string[];
      hookNames: string[];
      openPrs: OpenPrWarningItem[];
      localChanges?: LocalChangesWarning | null;
    },
  ]
>('workspaceOperations/openDeleteWarning');

export const closeDeleteWarning = createAction('workspaceOperations/closeDeleteWarning');

export const openArchiveWarning = createAction<
  [
    payload: {
      workspaceId: string;
      agentNames: string[];
      hookNames: string[];
      openPrs: OpenPrWarningItem[];
      localChanges?: LocalChangesWarning | null;
    },
  ]
>('workspaceOperations/openArchiveWarning');

export const closeArchiveWarning = createAction('workspaceOperations/closeArchiveWarning');

export const confirmArchiveWorkspace = createAction('workspaceOperations/confirmArchiveWorkspace');

export const openBulkArchiveConfirm = createAction<
  [payload: { workspaceIds: string[]; groupLabel: string }]
>('workspaceOperations/openBulkArchiveConfirm');

export const closeBulkArchiveConfirm = createAction('workspaceOperations/closeBulkArchiveConfirm');

export const confirmBulkArchive = createAction('workspaceOperations/confirmBulkArchive');

export const openBulkDeleteConfirm = createAction<
  [payload: { workspaceIds: string[]; groupLabel: string }]
>('workspaceOperations/openBulkDeleteConfirm');

export const closeBulkDeleteConfirm = createAction('workspaceOperations/closeBulkDeleteConfirm');

export const confirmBulkDelete = createAction('workspaceOperations/confirmBulkDelete');

export const bulkActiveWorkComputed = createAction<
  [
    payload: {
      kind: 'archive' | 'delete';
      agentCount: number;
      hookCount: number;
      token: number;
    },
  ]
>('workspaceOperations/bulkActiveWorkComputed');

export const openRemoveRepoConfirm = createAction<[repoPath: string]>(
  'workspaceOperations/openRemoveRepoConfirm',
);

export const closeRemoveRepoConfirm = createAction('workspaceOperations/closeRemoveRepoConfirm');

export const confirmRemoveRepo = createAction('workspaceOperations/confirmRemoveRepo');

export const workspaceOperationsReducer = createReducer<WorkspaceOperationsState>(initialState);
workspaceOperationsReducer.with(
  openDeleteWarning,
  (state, { payload: [{ workspaceId, agentNames, hookNames, openPrs, localChanges }] }) => ({
    ...state,
    showDeleteWarning: true,
    pendingDeleteWorkspaceId: workspaceId,
    runningAgentNamesForDelete: agentNames,
    activeHookNamesForDelete: hookNames,
    openPrsForDelete: createCollection<OpenPrWarningItem, 'number'>('number', openPrs),
    localChangesForDelete: localChanges ?? null,
  }),
);
workspaceOperationsReducer.with(closeDeleteWarning, (state) => ({
  ...state,
  showDeleteWarning: false,
  pendingDeleteWorkspaceId: null,
  runningAgentNamesForDelete: [],
  activeHookNamesForDelete: [],
  openPrsForDelete: emptyOpenPrs(),
  localChangesForDelete: null,
}));
workspaceOperationsReducer.with(
  openArchiveWarning,
  (state, { payload: [{ workspaceId, agentNames, hookNames, openPrs, localChanges }] }) => ({
    ...state,
    showArchiveWarning: true,
    pendingArchiveWorkspaceId: workspaceId,
    runningAgentNamesForArchive: agentNames,
    activeHookNamesForArchive: hookNames,
    openPrsForArchive: createCollection<OpenPrWarningItem, 'number'>('number', openPrs),
    localChangesForArchive: localChanges ?? null,
  }),
);
workspaceOperationsReducer.with(closeArchiveWarning, (state) => ({
  ...state,
  showArchiveWarning: false,
  pendingArchiveWorkspaceId: null,
  runningAgentNamesForArchive: [],
  activeHookNamesForArchive: [],
  openPrsForArchive: emptyOpenPrs(),
  localChangesForArchive: null,
}));
workspaceOperationsReducer.with(
  openBulkArchiveConfirm,
  (state, { payload: [{ workspaceIds, groupLabel }] }) => ({
    ...state,
    showBulkArchiveConfirm: true,
    showBulkDeleteConfirm: false,
    pendingBulkWorkspaceIds: workspaceIds,
    pendingBulkGroupLabel: groupLabel,
    bulkActiveAgentCount: 0,
    bulkActiveHookCount: 0,
    bulkComputeToken: state.bulkComputeToken + 1,
  }),
);
workspaceOperationsReducer.with(closeBulkArchiveConfirm, (state) => ({
  ...state,
  showBulkArchiveConfirm: false,
  pendingBulkWorkspaceIds: [],
  pendingBulkGroupLabel: null,
  bulkActiveAgentCount: 0,
  bulkActiveHookCount: 0,
}));
workspaceOperationsReducer.with(
  openBulkDeleteConfirm,
  (state, { payload: [{ workspaceIds, groupLabel }] }) => ({
    ...state,
    showBulkArchiveConfirm: false,
    showBulkDeleteConfirm: true,
    pendingBulkWorkspaceIds: workspaceIds,
    pendingBulkGroupLabel: groupLabel,
    bulkActiveAgentCount: 0,
    bulkActiveHookCount: 0,
    bulkComputeToken: state.bulkComputeToken + 1,
  }),
);
workspaceOperationsReducer.with(closeBulkDeleteConfirm, (state) => ({
  ...state,
  showBulkDeleteConfirm: false,
  pendingBulkWorkspaceIds: [],
  pendingBulkGroupLabel: null,
  bulkActiveAgentCount: 0,
  bulkActiveHookCount: 0,
}));
workspaceOperationsReducer.with(
  bulkActiveWorkComputed,
  (state, { payload: [{ kind, agentCount, hookCount, token }] }) => {
    if (
      (kind === 'archive' ? !state.showBulkArchiveConfirm : !state.showBulkDeleteConfirm) ||
      state.bulkComputeToken !== token
    ) {
      return state;
    }
    return {
      ...state,
      bulkActiveAgentCount: agentCount,
      bulkActiveHookCount: hookCount,
    };
  },
);
workspaceOperationsReducer.with(openRemoveRepoConfirm, (state, { payload: [repoPath] }) => ({
  ...state,
  showRemoveRepoConfirm: true,
  pendingRemoveRepoPath: repoPath,
}));
workspaceOperationsReducer.with(closeRemoveRepoConfirm, (state) => ({
  ...state,
  showRemoveRepoConfirm: false,
  pendingRemoveRepoPath: null,
}));

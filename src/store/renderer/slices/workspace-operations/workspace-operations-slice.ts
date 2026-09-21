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

export const openBulkArchiveConfirm = createAction<[repoKey: string]>(
  'workspaceOperations/openBulkArchiveConfirm',
);

export const closeBulkArchiveConfirm = createAction('workspaceOperations/closeBulkArchiveConfirm');

export const confirmBulkArchive = createAction('workspaceOperations/confirmBulkArchive');

export const bulkArchiveActiveWorkComputed = createAction<
  [payload: { repoKey: string; agentCount: number; hookCount: number; token: number }]
>('workspaceOperations/bulkArchiveActiveWorkComputed');

export const openBulkDeleteArchivedConfirm = createAction<[repoKey: string]>(
  'workspaceOperations/openBulkDeleteArchivedConfirm',
);

export const closeBulkDeleteArchivedConfirm = createAction(
  'workspaceOperations/closeBulkDeleteArchivedConfirm',
);

export const confirmBulkDeleteArchived = createAction(
  'workspaceOperations/confirmBulkDeleteArchived',
);

export const openBulkDeleteWarningConfirm = createAction<
  [payload: { repoKey: string; workspaceCount: number; agentCount: number; hookCount: number }]
>('workspaceOperations/openBulkDeleteWarningConfirm');

export const closeBulkDeleteWarningConfirm = createAction(
  'workspaceOperations/closeBulkDeleteWarningConfirm',
);

export const confirmBulkDeleteWarning = createAction(
  'workspaceOperations/confirmBulkDeleteWarning',
);

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
workspaceOperationsReducer.with(openBulkArchiveConfirm, (state, { payload: [repoKey] }) => ({
  ...state,
  showBulkArchiveConfirm: true,
  pendingBulkRepoKey: repoKey,
  bulkArchiveActiveAgentCount: 0,
  bulkArchiveActiveHookCount: 0,
  bulkArchiveComputeToken: state.bulkArchiveComputeToken + 1,
}));
workspaceOperationsReducer.with(closeBulkArchiveConfirm, (state) => ({
  ...state,
  showBulkArchiveConfirm: false,
  pendingBulkRepoKey: undefined,
  bulkArchiveActiveAgentCount: 0,
  bulkArchiveActiveHookCount: 0,
}));
workspaceOperationsReducer.with(
  bulkArchiveActiveWorkComputed,
  (state, { payload: [{ repoKey, agentCount, hookCount, token }] }) => {
    if (
      !state.showBulkArchiveConfirm ||
      state.pendingBulkRepoKey !== repoKey ||
      state.bulkArchiveComputeToken !== token
    ) {
      return state;
    }
    return {
      ...state,
      bulkArchiveActiveAgentCount: agentCount,
      bulkArchiveActiveHookCount: hookCount,
    };
  },
);
workspaceOperationsReducer.with(openBulkDeleteArchivedConfirm, (state, { payload: [repoKey] }) => ({
  ...state,
  showBulkDeleteArchivedConfirm: true,
  pendingBulkRepoKey: repoKey,
}));
workspaceOperationsReducer.with(closeBulkDeleteArchivedConfirm, (state) => ({
  ...state,
  showBulkDeleteArchivedConfirm: false,
  pendingBulkRepoKey: undefined,
}));
workspaceOperationsReducer.with(
  openBulkDeleteWarningConfirm,
  (state, { payload: [{ repoKey, workspaceCount, agentCount, hookCount }] }) => ({
    ...state,
    showBulkDeleteWarningConfirm: true,
    pendingBulkDeleteRepoKey: repoKey,
    bulkDeleteWorkspaceCount: workspaceCount,
    bulkDeleteActiveAgentCount: agentCount,
    bulkDeleteActiveHookCount: hookCount,
  }),
);
workspaceOperationsReducer.with(closeBulkDeleteWarningConfirm, (state) => ({
  ...state,
  showBulkDeleteWarningConfirm: false,
  pendingBulkDeleteRepoKey: null,
  bulkDeleteWorkspaceCount: 0,
  bulkDeleteActiveAgentCount: 0,
  bulkDeleteActiveHookCount: 0,
}));
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

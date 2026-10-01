import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import { PullRequestStatus } from '$shared/types';
import {
  constructPrUrl,
  mapWorkspacePRs,
  sectionPRs,
} from '$lib/components/workspace/sidebar/sidebar-changes-utils';
import { getPRDisplayTitle } from '$lib/utils/pull-request-utils';
import { store } from '../../store';
import { selectAcceptChangesStatus, selectPostMergeState } from '../git/git-selectors';
import {
  selectWorkspaceById,
  selectIsWorkspaceCollaborator,
} from '../workspace/workspace-selectors';
import {
  selectFileTrackingCommits,
  selectFileTrackingIsInitialized,
} from '../changes/changes-selectors';
import { selectGitHubAuthIsAuthenticated } from '../github-auth/github-auth-selectors';
import { selectPrMonitors } from '../pr-monitor/pr-monitor-selectors';
import { selectGitRoots } from '../git-roots/git-roots-selectors';
import { emptyAcceptWorkflowWorkspace } from './accept-workflow-slice';
import type { AcceptOperationKind, MergeOptions } from './accept-workflow-types';

export const selectAcceptOperation = store.createSelector(
  (state, workspaceId: string, kind: AcceptOperationKind) =>
    getItem(
      (state.acceptWorkflow.byWorkspaceId[workspaceId] ?? emptyAcceptWorkflowWorkspace).operations,
      kind,
    ),
);
export const selectAcceptOperationPending = store.createSelector(
  (state, workspaceId: string, kind: AcceptOperationKind) =>
    selectAcceptOperation.select(state, workspaceId, kind)?.status === 'running',
);
export const selectMergeDrawerOpen = store.createSelector(
  (state, workspaceId: string) =>
    state.acceptWorkflow.byWorkspaceId[workspaceId]?.mergeDrawerOpen ?? false,
);

export const selectMergeOptions = store.createSelector(
  (state, workspaceId: string): MergeOptions => {
    const hasRemote = selectAcceptChangesStatus.select(state, workspaceId)?.hasRemote ?? false;
    const hasOpenPR =
      selectWorkspaceById
        .select(state, workspaceId)
        ?.pullRequests?.some(
          (pr) => pr.status === PullRequestStatus.Open || pr.status === PullRequestStatus.Draft,
        ) ?? false;
    return {
      squash: false,
      viaPR: hasRemote && hasOpenPR,
      pushAfter: hasRemote,
      ...state.acceptWorkflow.byWorkspaceId[workspaceId]?.mergeOptions,
    };
  },
);

/** Primitive inputs keep the lifecycle observer asleep on unrelated renderer updates. */
export const selectAcceptObserverWorkspaceIds = store.createSelector((state) =>
  Object.keys(state.acceptWorkflow.byWorkspaceId).filter(
    (workspaceId) => state.acceptWorkflow.byWorkspaceId[workspaceId].observerRequested,
  ),
);

export const selectAcceptObservation = store.createSelector((state, workspaceId: string) => {
  const workspace = selectWorkspaceById.select(state, workspaceId);
  const commits = selectFileTrackingCommits.select(state, workspaceId);
  const postMerge = selectPostMergeState.select(state, workspaceId);
  const repo =
    workspace?.repositoryOwner && workspace.repositoryName
      ? `${workspace.repositoryOwner}/${workspace.repositoryName}`
      : undefined;
  const prs = sectionPRs(
    mapWorkspacePRs(
      workspace?.pullRequests,
      workspace?.activePullRequest,
      (number, fallback) =>
        constructPrUrl(number, workspace?.repositoryOwner, workspace?.repositoryName, fallback),
      getPRDisplayTitle,
      repo,
    ),
    selectPrMonitors.select(state, workspaceId),
    repo,
    selectGitRoots.select(state, workspaceId),
    getPRDisplayTitle,
  ).own;
  return {
    visible: (state.acceptWorkflow.byWorkspaceId[workspaceId]?.consumerCount ?? 0) > 0,
    ready: selectFileTrackingIsInitialized.select(state, workspaceId),
    owner: !selectIsWorkspaceCollaborator.select(state, workspaceId),
    authenticated: selectGitHubAuthIsAuthenticated.select(state),
    pushedCount: commits.filter((commit) => commit.isPushed).length,
    hasRemote: postMerge.hasRemote,
    clearReset: postMerge.hasResetToTrunk && prs.some((pr) => pr.status !== 'merged'),
    clearMerge: !!(
      postMerge.mergeHeadSha &&
      commits[0]?.hash &&
      postMerge.mergeHeadSha !== commits[0].hash
    ),
  };
});

import type { WorkspaceGitStatus } from '$features/accept-changes/types';
import type { TaskStats } from '$shared/utils/task-stats';
import type { StoreAction } from '@themislib/themis/types';
import type { SagaGenerator } from 'typed-redux-saga';
import type { Workspace } from '$shared/types';
import type { WorkspacesClient } from '$lib/client/workspaces-client-types';

export interface WorkspaceTitleRequest {
  workspaceId: Workspace['id'];
  title: string;
  previousTitle: string;
  token: number;
  /** Guarded hosts capture these before enqueue, never in the worker. */
  requestId?: string;
  authority?: string;
  /** Connection/view generation, distinct from principal authority retained on the receipt. */
  context?: string;
  viewId?: string;
  /** Guarded editors capture the title revision when editing starts, before any later events. */
  expectedRevision?: number;
}

export type RenameWorkspaceTitleResult =
  { ok: true } | { ok: false; error: string; outcome?: 'failed' | 'unknown' };

/** An operation receipt, not a second workspace entity. Retained until app reload. */
export interface WorkspaceTitleOperation {
  requestId: string;
  workspaceId: string;
  authority: string;
  viewId: string;
  title: string;
  baseTitle: string;
  observedRevision: number;
  status: 'queued' | 'running' | 'confirmed' | 'failed' | 'unknown';
  error?: string;
}

export interface WorkspaceTitleView {
  viewId: string;
  workspaceId: string;
  authority: string;
  /** A released registration can never be reopened, even in the same context. */
  released: boolean;
}

export interface WorkspaceTitleSagaDependencies {
  update: WorkspacesClient['update'];
  selectWorkspace(workspaceId: string): SagaGenerator<Workspace | undefined>;
  selectPendingToken(workspaceId: string): SagaGenerator<number | undefined>;
  /** Present only in an authority-aware host. Named selector effects belong to the host. */
  admission?: {
    selectOperations(workspaceId: string): SagaGenerator<WorkspaceTitleOperation[]>;
    selectRevision(workspaceId: string): SagaGenerator<number>;
    /** Named projection read at the synchronous transport boundary. */
    readRevision(workspaceId: string): number;
    /** Includes the original view registration, principal and request guard. */
    isCurrent(request: WorkspaceTitleRequest): boolean;
    /** Principal/backend publication guard, independent of whether the view remains open. */
    canPublish(request: WorkspaceTitleRequest): boolean;
    dispatch(action: StoreAction<unknown>): unknown;
  };
  onError?(error: unknown): void;
  showError?(message: string): Promise<void>;
}

/**
 * The workflow stage a workspace is currently in, derived from git status,
 * task progress, and pull-request state. Drives the progress card copy/actions.
 */
export type WorkflowStage =
  | 'loading' // Loading git status
  | 'spec-empty' // Spec has no content and no agent working
  | 'spec-creating' // Agent working on spec
  | 'spec-ready' // Spec exists with content, no tasks
  | 'tasks-ready' // Tasks exist, none started
  | 'tasks-in-progress' // Some tasks in progress
  | 'pr-merged' // PR was merged, might have new changes
  | 'pr-approved' // PR approved, ready to merge
  | 'pr-open' // PR exists and open
  | 'commits-unpushed' // Local commits, ready to push/create PR
  | 'changes-staged' // Staged changes, ready to commit
  | 'changes-unstaged' // Unstaged changes to review
  | 'all-done'; // Nothing left to do

/**
 * Presentational, non-store inputs the progress selectors read. PR data is NOT
 * part of this input — it is read authoritatively from the workspace slice by id.
 */
export interface WorkspaceProgressInput {
  gitStatus: WorkspaceGitStatus | null;
  gitStatusLoading: boolean;
  taskStats: TaskStats;
  completionRatio: number;
  isAgentWorking: boolean;
  specHasContent: boolean;
}

/** Headline/subtext copy for the progress card, derived from the workflow stage. */
export interface WorkspaceProgressHeadline {
  headline: string;
  subtext: string;
}

/** Normalized PR status for the active-PR summary chip. */
export type WorkspaceActivePrStatus = 'open' | 'merged' | 'closed' | 'draft' | 'unknown';

/** Shared PR action presentation for sidebar surfaces. */
export interface WorkspaceActivePrSummary {
  number: number;
  url: string;
  /** `owner/name` of the PR's repo when known (workspace repo or monitor repo). */
  repo?: string;
  /**
   * `repo #N` / `owner/repo #N` identifier per the `getPrChipLabel` convention;
   * `#N` when the repo cannot be determined at all.
   */
  chipLabel: string;
  /** PR title; absent when the source carries none (legacy path, unpolled monitor). */
  title?: string;
  status: WorkspaceActivePrStatus;
  actionLabel: string;
  actionTooltip: string;
}

/** Semantic identifier mapping a progress action to a component onClick handler. */
type WorkspaceProgressActionId =
  'review-changes' | 'commit' | 'push-or-create-pr' | 'view-pr' | 'merge-pr';

/** Semantic icon key the component maps to a concrete fa-icon. */
export type WorkspaceProgressActionIconKey =
  'file-lines' | 'check' | 'code-pull-request' | 'code-branch';

/**
 * Pure, serializable action descriptor. Contains no onClick closures or icon
 * objects — the component resolves those from `id`/`iconKey`. `url` is set for
 * PR-open / PR-approved descriptors.
 */
export interface WorkspaceProgressAction {
  id: WorkspaceProgressActionId;
  label: string;
  iconKey: WorkspaceProgressActionIconKey;
  tooltip?: string;
  url?: string;
}

/**
 * Workspace Phase System
 *
 * Defines the 4 phases of a workspace lifecycle:
 * 1. Planning - Coordinator researches and creates a Spec
 * 2. Building - Agents implement tasks from the spec
 * 3. Reviewing - Work is done, review and ship changes
 * 4. Shipped - All changes merged, workspace complete
 *
 * ## Data Flow & Consistency Notes
 *
 * Workspace entities carry only metadata (PR status, etc.). Task progress and
 * change/commit data live in separated sources (workspace-tasks slice,
 * workspace-summaries slice, changes slice); callers pass them via the
 * `taskProgress` / `hasChangedFiles` opts and the `deriveWorkspaceStats` data
 * parameter.
 *
 * All callers MUST pass `{ hasActiveAgents }` from activeStreamsTracker when
 * the calling component has access to agent streaming state. Without it, the
 * phase will show "planning" even when agents are actively working but no
 * tasks have transitioned to in_progress yet.
 *
 * The canonical timestamp for workspace recency is centralized in
 * `$shared/utils/workspace-activity-time`.
 * - `updatedAt`: set by explicit backend update() calls (rename, archive, etc.)
 * - `lastActivity`: set locally in the store on meaningful event-driven changes.
 * - When agents are streaming, display components should show "Active" instead
 *   of a stale relative timestamp.
 */

import type { Workspace } from '$shared/types';
import { PullRequestStatus } from '$shared/types';
import { m } from '$shared/paraglide/messages.js';
import { formatInteger } from '$lib/i18n/format';

export type WorkspacePhase = 'planning' | 'building' | 'reviewing' | 'shipped';

export interface WorkspacePhaseInfo {
  phase: WorkspacePhase;
  label: string;
  subtitle: string;
  isActive: boolean;
}

export interface WorkspacePhaseStats {
  tasks: { total: number; completed: number; inProgress: number; notStarted: number };
  files: { changed: number; additions: number; deletions: number };
  commits: { total: number; unpushed: number };
  pr: { hasOpen: boolean; hasMerged: boolean; hasClosed: boolean; number?: number; url?: string };
}

export const PHASE_META: Record<WorkspacePhase, { label: string; description: string }> = {
  planning: {
    get label() {
      return m.workspace_phase_planning_label();
    },
    get description() {
      return m.workspace_phase_planning_description();
    },
  },
  building: {
    get label() {
      return m.workspace_phase_building_label();
    },
    get description() {
      return m.workspace_phase_building_description();
    },
  },
  reviewing: {
    get label() {
      return m.workspace_phase_reviewing_label();
    },
    get description() {
      return m.workspace_phase_reviewing_description();
    },
  },
  shipped: {
    get label() {
      return m.workspace_phase_shipped_label();
    },
    get description() {
      return m.workspace_phase_shipped_description();
    },
  },
};

export interface WorkspaceTaskProgressLike {
  total: number;
  completed: number;
  inProgress: number;
}

/** Derive the current phase of a workspace from its metadata plus separated task/change data. */
export function deriveWorkspacePhase(
  workspace: Workspace,
  opts?: {
    hasActiveAgents?: boolean;
    hasSpecContent?: boolean;
    isAgentCreatingSpec?: boolean;
    /** Task progress from the workspace-tasks slice (selectWorkspaceTaskProgress). */
    taskProgress?: WorkspaceTaskProgressLike;
    /** Whether the workspace has changed files; only affects 'reviewing' subtitle wording. */
    hasChangedFiles?: boolean;
  },
): WorkspacePhaseInfo {
  const prs = workspace.pullRequests || [];
  const active = opts?.hasActiveAgents ?? false;
  const specCreating = opts?.isAgentCreatingSpec ?? false;
  const activePRStatus = workspace.activePullRequest?.status;
  const hasMerged =
    workspace.prStatus === PullRequestStatus.Merged ||
    activePRStatus === PullRequestStatus.Merged ||
    prs.some((p) => p.status === PullRequestStatus.Merged);
  const hasOpen =
    workspace.prStatus === PullRequestStatus.Open ||
    workspace.prStatus === PullRequestStatus.Draft ||
    prs.some((p) => p.status === PullRequestStatus.Open || p.status === PullRequestStatus.Draft) ||
    activePRStatus === PullRequestStatus.Open ||
    activePRStatus === PullRequestStatus.Draft;
  const t = opts?.taskProgress?.total ?? 0;
  const c = opts?.taskProgress?.completed ?? 0;
  const ip = opts?.taskProgress?.inProgress ?? 0;
  const allDone = t > 0 && c === t;
  const hasFiles = opts?.hasChangedFiles ?? false;

  if (hasMerged) {
    const pr = prs.find((p) => p.status === PullRequestStatus.Merged);
    return {
      phase: 'shipped',
      label: m.workspace_phase_shipped_label(),
      subtitle: pr
        ? m.workspace_phase_prMerged_label({ number: pr.number })
        : m.workspace_phase_allSet_label(),
      isActive: false,
    };
  }
  if (hasOpen) {
    const pr =
      prs.find(
        (p) => p.status === PullRequestStatus.Open || p.status === PullRequestStatus.Draft,
      ) || workspace.activePullRequest;
    return {
      phase: 'reviewing',
      label: m.workspace_phase_reviewing_label(),
      subtitle: pr
        ? m.workspace_phase_prOpenNumber_label({ number: pr.number })
        : m.workspace_phase_prOpen_label(),
      isActive: false,
    };
  }
  if (allDone) {
    return {
      phase: 'reviewing',
      label: m.workspace_phase_reviewing_label(),
      subtitle: hasFiles
        ? m.workspace_phase_reviewAndCreatePr_label()
        : m.workspace_phase_timeToReviewAndShip_label(),
      isActive: false,
    };
  }
  if (t > 0 && (ip > 0 || c > 0 || active)) {
    return {
      phase: 'building',
      label: m.workspace_phase_building_label(),
      subtitle:
        ip > 0
          ? ip === 1
            ? m.workspace_phase_tasksBeingImplemented_one()
            : m.workspace_phase_tasksBeingImplemented_many({ count: formatInteger(ip) })
          : m.workspace_phase_tasksComplete_label({
              completed: formatInteger(c),
              total: formatInteger(t),
            }),
      isActive: active,
    };
  }
  return {
    phase: 'planning',
    label: m.workspace_phase_planning_label(),
    subtitle: specCreating
      ? m.workspace_phase_coordinatorResearching_label()
      : t > 0 || opts?.hasSpecContent
        ? m.workspace_phase_specReady_label()
        : m.workspace_phase_describeWhatToBuild_label(),
    isActive: specCreating || active,
  };
}

/** Assemble display stats from workspace PR metadata plus separated task/change/commit data. */
export function deriveWorkspaceStats(
  ws: Workspace,
  data?: {
    /** Task progress from the workspace-tasks slice (selectWorkspaceTaskProgress). */
    taskProgress?: WorkspaceTaskProgressLike;
    /** File change totals from the changes slice or workspace-summaries diff summary. */
    files?: { changed: number; additions: number; deletions: number };
    /** Commit counts from the changes slice or workspace-summaries git summary. */
    commits?: { total: number; unpushed: number };
  },
): WorkspacePhaseStats {
  const prs = ws.pullRequests || [];
  const t = data?.taskProgress?.total ?? 0;
  const c = data?.taskProgress?.completed ?? 0;
  const ip = data?.taskProgress?.inProgress ?? 0;
  const activePRStatus = ws.activePullRequest?.status;
  const hasMerged =
    ws.prStatus === PullRequestStatus.Merged ||
    activePRStatus === PullRequestStatus.Merged ||
    prs.some((p) => p.status === PullRequestStatus.Merged);
  const hasOpen =
    ws.prStatus === PullRequestStatus.Open ||
    ws.prStatus === PullRequestStatus.Draft ||
    prs.some((p) => p.status === PullRequestStatus.Open || p.status === PullRequestStatus.Draft) ||
    activePRStatus === PullRequestStatus.Open ||
    activePRStatus === PullRequestStatus.Draft;
  const hasClosed =
    ws.prStatus === PullRequestStatus.Closed ||
    activePRStatus === PullRequestStatus.Closed ||
    prs.some((p) => p.status === PullRequestStatus.Closed);
  const activePR =
    prs.find(
      (p) =>
        p.status === PullRequestStatus.Open ||
        p.status === PullRequestStatus.Draft ||
        p.status === PullRequestStatus.Merged ||
        p.status === PullRequestStatus.Closed,
    ) || ws.activePullRequest;
  return {
    tasks: {
      total: t,
      completed: c,
      inProgress: ip,
      notStarted: Math.max(0, t - c - ip),
    },
    files: {
      changed: data?.files?.changed ?? 0,
      additions: data?.files?.additions ?? 0,
      deletions: data?.files?.deletions ?? 0,
    },
    commits: {
      total: data?.commits?.total ?? 0,
      unpushed: data?.commits?.unpushed ?? 0,
    },
    pr: {
      hasOpen,
      hasMerged,
      hasClosed,
      number: activePR?.number,
      url: activePR?.url,
    },
  };
}

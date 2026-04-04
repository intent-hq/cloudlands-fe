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
 * Workspace objects come from Redux workspace state which loads in two passes:
 *  - **Lite mode**: taskStats, diffSummary, agentSummary, gitSummary are undefined.
 *  - **Full mode** (500ms later): enrichment fields are populated.
 *
 * All callers MUST pass `{ hasActiveAgents }` from activeStreamsTracker when
 * the calling component has access to agent streaming state. Without it, the
 * phase will show "planning" even when agents are actively working but no
 * tasks have transitioned to in_progress yet.
 *
 * The canonical timestamp for workspace recency is `lastActivity || updatedAt`.
 * - `updatedAt`: set by explicit backend update() calls (rename, archive, etc.)
 * - `lastActivity`: set locally in the store on meaningful event-driven changes.
 * - When agents are streaming, display components should show "Active" instead
 *   of a stale relative timestamp.
 */

import type { Workspace } from '$shared/types';
import { PullRequestStatus } from '$shared/types';

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
    label: 'Planning',
    description: 'The Coordinator will research and create a Spec. You can edit and iterate on it.',
  },
  building: {
    label: 'Building',
    description: 'Once approved, the Coordinator will delegate the work and verify it.',
  },
  reviewing: {
    label: 'Reviewing',
    description: 'Once the work is done, review and ship the changes.',
  },
  shipped: {
    label: 'Shipped',
    description: 'All set! No un-merged changes.',
  },
};

/** Derive the current phase of a workspace from its data. */
export function deriveWorkspacePhase(
  workspace: Workspace,
  opts?: {
    hasActiveAgents?: boolean;
    hasSpecContent?: boolean;
    isAgentCreatingSpec?: boolean;
  },
): WorkspacePhaseInfo {
  const prs = workspace.pullRequests || [];
  const active = opts?.hasActiveAgents ?? false;
  const specCreating = opts?.isAgentCreatingSpec ?? false;
  const hasMerged =
    workspace.prStatus === PullRequestStatus.Merged ||
    prs.some((p) => p.status === PullRequestStatus.Merged);
  const hasOpen =
    workspace.prStatus === PullRequestStatus.Open ||
    workspace.prStatus === PullRequestStatus.Draft ||
    prs.some((p) => p.status === PullRequestStatus.Open || p.status === PullRequestStatus.Draft) ||
    !!workspace.activePullRequest;
  const t = workspace.taskStats?.total ?? 0;
  const c = workspace.taskStats?.completed ?? 0;
  const ip = workspace.taskStats?.inProgress ?? 0;
  const allDone = t > 0 && c === t;
  const hasFiles = (workspace.diffSummary?.totalFiles ?? 0) > 0;

  if (hasMerged) {
    const pr = prs.find((p) => p.status === PullRequestStatus.Merged);
    return {
      phase: 'shipped',
      label: 'Shipped',
      subtitle: pr ? `PR #${pr.number} merged` : 'All set!',
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
      label: 'Reviewing',
      subtitle: pr ? `PR #${pr.number} open` : 'PR open',
      isActive: false,
    };
  }
  if (allDone) {
    return {
      phase: 'reviewing',
      label: 'Reviewing',
      subtitle: hasFiles ? 'Review changes and create a PR' : 'Time to review and ship',
      isActive: false,
    };
  }
  if (t > 0 && (ip > 0 || c > 0 || active)) {
    return {
      phase: 'building',
      label: 'Building',
      subtitle:
        ip > 0
          ? `${ip} task${ip === 1 ? '' : 's'} being implemented`
          : `${c} of ${t} tasks complete`,
      isActive: active,
    };
  }
  return {
    phase: 'planning',
    label: 'Planning',
    subtitle: specCreating
      ? 'Coordinator is researching...'
      : t > 0 || opts?.hasSpecContent
        ? 'Spec ready for review'
        : 'Describe what you want to build',
    isActive: specCreating || active,
  };
}

/** Extract stats from workspace data for display in cards. */
export function deriveWorkspaceStats(ws: Workspace): WorkspacePhaseStats {
  const prs = ws.pullRequests || [];
  const t = ws.taskStats?.total ?? 0;
  const c = ws.taskStats?.completed ?? 0;
  const ip = ws.taskStats?.inProgress ?? 0;
  const hasMerged =
    ws.prStatus === PullRequestStatus.Merged ||
    prs.some((p) => p.status === PullRequestStatus.Merged);
  const hasOpen =
    ws.prStatus === PullRequestStatus.Open ||
    ws.prStatus === PullRequestStatus.Draft ||
    prs.some((p) => p.status === PullRequestStatus.Open || p.status === PullRequestStatus.Draft) ||
    !!ws.activePullRequest;
  const hasClosed =
    ws.prStatus === PullRequestStatus.Closed ||
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
      changed: ws.diffSummary?.totalFiles ?? 0,
      additions: ws.diffSummary?.totalAdditions ?? 0,
      deletions: ws.diffSummary?.totalDeletions ?? 0,
    },
    commits: {
      total: ws.gitSummary?.ahead ?? 0,
      unpushed: ws.gitSummary?.hasUnpushed ? (ws.gitSummary?.ahead ?? 0) : 0,
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

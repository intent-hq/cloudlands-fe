<script lang="ts">
  import type { AgentSession, PullRequestInfo, Workspace, WorkspaceAgentInfo } from '$shared/types';
  import {
  PullRequestStatus,
  WorkspaceStatusEnum,
} from '$shared/types';
  import { formatDistanceToNow } from 'date-fns';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import AugieAvatarWithState from '$lib/components/ui/auggie-avatar/AugieAvatarWithState.svelte';
  import type { AvatarState } from '$lib/components/ui/auggie-avatar/avatar-state';
  import type { BuiltinSpecialistId } from '$lib/constants/specialists';
  import { activeStreamsTracker } from '$features/agent/services/active-streams-tracker';
  import { onMount } from 'svelte';
  import { writable } from 'svelte/store';
  import Fa from 'svelte-fa';
  import {
  faCodeMerge,
  faCodePullRequest,
} from '@fortawesome/free-solid-svg-icons';
  import {
  selectUnreadAgentIds,
  selectUnreadAgentIdsForWorkspace,
} from '$lib/store/slices/unread-tracking/unread-tracking-selectors';
  import { selectAllWorkspaceAgents } from '$lib/store/slices/workspace-agents/workspace-agents-selectors';
  import { ensureAgentSessionLoaded } from '$lib/store/slices/workspace-agents/workspace-agents-slice';
  import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
  import { getDispatch } from '$lib/store/utils/svelte-context';
  import { getWorkspaceActivityDisplayTime } from '$shared/utils/workspace-activity-time';

  interface Props {
    workspace: Workspace | null;
    lineStats?: { additions: number; deletions: number };
    isLoading?: boolean;
    activeAgentIds?: string[];
    /** Keep true in production; sandbox routes can disable session restoration/fetching. */
    loadAgentSessions?: boolean;
  }

  let {
    workspace,
    lineStats,
    isLoading = false,
    activeAgentIds = [],
    loadAgentSessions = true,
  }: Props = $props();

  const dispatch = getDispatch();
  const workspaceIdStore = writable('');
  $effect(() => {
    workspaceIdStore.set(workspace?.id ?? '');
  });

  const ACTIVE_AGENT_STATUSES = new Set([
    'active',
    'busy',
    'processing',
    'pending',
    'responding',
    'running',
    'streaming',
    'waiting',
    'background',
    'queued',
    'starting',
    'in_progress',
  ]);

  function formatRelativeDate(date: string | number | undefined) {
    if (!date) return null;
    try {
      const parsed = new Date(date);
      if (!Number.isFinite(parsed.getTime())) return null;
      return formatDistanceToNow(parsed, { addSuffix: true });
    } catch {
      return 'Recently';
    }
  }

  function titleCase(value: string | undefined) {
    if (!value) return null;
    return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase().replaceAll('_', ' ');
  }

  function pluralize(count: number, singular: string, plural = `${singular}s`) {
    return `${count} ${count === 1 ? singular : plural}`;
  }

  function getWorkspacePullRequest(workspace: Workspace | null): PullRequestInfo | null {
    if (!workspace) return null;
    const pr = workspace.activePullRequest ?? workspace.pullRequests?.[0] ?? null;
    if (pr) return pr;
    if (!workspace.prStatus) return null;

    return {
      id: `legacy-pr-${workspace.prNumber ?? 'workspace'}`,
      number: workspace.prNumber ?? 0,
      url: workspace.prUrl ?? '',
      title: 'Pull request',
      status: workspace.prStatus,
      createdAt: workspace.updatedAt,
      updatedAt: workspace.updatedAt,
    };
  }

  function getPullRequestDisplayStatus(pr: PullRequestInfo | null, legacyStatus?: PullRequestStatus) {
    return pr?.isDraft ? PullRequestStatus.Draft : (pr?.status ?? legacyStatus ?? null);
  }

  function formatPullRequestDetails(pr: PullRequestInfo | null, legacyStatus?: PullRequestStatus) {
    const status = pr?.isDraft ? PullRequestStatus.Draft : (pr?.status ?? legacyStatus);
    if (!status) return null;

    const parts: string[] = [];
    if (!pr?.number || status !== PullRequestStatus.Open) parts.push(titleCase(status) ?? status);
    if (pr?.mergeConflicts) parts.push('conflicts');
    if (pr?.ciStatus?.failed) parts.push('CI failing');
    else if (pr?.ciStatus?.pending) parts.push('CI pending');
    if (pr?.reviewDecision === 'APPROVED') parts.push('approved');
    if (pr?.reviewDecision === 'CHANGES_REQUESTED') parts.push('changes requested');
    return parts.length > 0 ? parts.join(' · ') : null;
  }

  function getPullRequestStatusColor(status: PullRequestStatus | null) {
    switch (status) {
      case PullRequestStatus.Open:
        return 'text-emerald-500';
      case PullRequestStatus.Merged:
        return 'text-purple-500';
      case PullRequestStatus.Closed:
        return 'text-red-500';
      default:
        return 'text-subtle';
    }
  }

  function getPullRequestStatusIcon(status: PullRequestStatus | null) {
    return status === PullRequestStatus.Merged ? faCodeMerge : faCodePullRequest;
  }

  function getPullRequestDetailsColor(pr: PullRequestInfo | null, status: PullRequestStatus | null) {
    if (pr?.mergeConflicts || pr?.ciStatus?.failed || pr?.reviewDecision === 'CHANGES_REQUESTED') {
      return 'text-red-500';
    }
    if (pr?.ciStatus?.pending) return 'text-amber-500';
    return getPullRequestStatusColor(status);
  }

  function formatGitSummary(summary: Workspace['gitSummary']) {
    if (!summary) return null;

    if (summary.ahead > 0 && summary.behind > 0) {
      return `+${summary.ahead} -${summary.behind}`;
    }
    if (summary.ahead > 0) return `${pluralize(summary.ahead, 'commit')} ahead remote`;
    if (summary.behind > 0) return `${pluralize(summary.behind, 'commit')} behind remote`;
    if (summary.hasUnpushed) return 'Local commits not pushed';
    return null;
  }

  function formatTaskProgress(stats: Workspace['taskStats']) {
    if (!stats || stats.total === 0) return null;

    const parts = [`${stats.completed}/${stats.total} done`];
    if (stats.inProgress > 0) parts.push(`${stats.inProgress} active`);
    return parts.join(' · ');
  }

  function getTaskStatusColor(status: string) {
    switch (status) {
      case 'complete':
        return 'bg-emerald-500';
      case 'in_progress':
        return 'bg-sky-400';
      case 'review_required':
        return 'bg-blue-500';
      case 'waiting':
        return 'bg-muted';
      default:
        return 'bg-muted/60';
    }
  }

  function buildTaskProgressSegments(stats: Workspace['taskStats']) {
    if (!stats || stats.total === 0) return [];

    if (stats.tasks?.length) {
      return stats.tasks.map((task) => ({
        label: task.title,
        status: task.status,
        weight: 1,
      }));
    }

    const waiting = Math.max(0, stats.total - stats.completed - stats.inProgress);
    return [
      { label: 'Complete', status: 'complete', weight: stats.completed },
      { label: 'In progress', status: 'in_progress', weight: stats.inProgress },
      { label: 'Not started', status: 'not_started', weight: waiting },
    ].filter((segment) => segment.weight > 0);
  }

  function getAgentStatus(agent: Pick<WorkspaceAgentInfo, 'status'>) {
    return agent.status.toLowerCase();
  }

  function getRunningAgentAvatarState(agent: Pick<WorkspaceAgentInfo, 'status'>): AvatarState {
    const status = getAgentStatus(agent);
    if (status === 'waiting') return 'waiting';
    if (status === 'responding') return 'responding';
    return 'running';
  }

  function formatRunningAgentStatus(agent: Pick<WorkspaceAgentInfo, 'status'>) {
    const status = getAgentStatus(agent);
    if (status === 'background') return 'Running';
    if (status === 'waiting') return 'Waiting';
    if (status === 'processing') return 'Processing';
    return 'Running';
  }

  function formatRunningAgentMetadata(agent: WorkspaceAgentInfo) {
    const parts = [formatRunningAgentStatus(agent)];
    const lastActivity = formatRelativeDate(agent.lastActivity);
    if (lastActivity) parts.push(lastActivity);
    return parts.join(' · ');
  }

  function sessionToAgentInfo(session: AgentSession): WorkspaceAgentInfo {
    const lastActivity = session.lastActivity || session.updatedAt;
    return {
      id: session.id,
      name: session.name || 'Agent',
      status: session.isStreaming ? 'streaming' : session.isProcessing ? 'processing' : session.status,
      specialist: session.metadata?.specialist as WorkspaceAgentInfo['specialist'],
      lastActivity: lastActivity instanceof Date ? lastActivity.toISOString() : lastActivity,
    };
  }

  function mergeAgentFields(
    preferred: WorkspaceAgentInfo,
    fallback: WorkspaceAgentInfo,
  ): WorkspaceAgentInfo {
    return {
      ...fallback,
      ...preferred,
      name:
        preferred.name && preferred.name !== 'Agent'
          ? preferred.name
          : fallback.name || preferred.name,
      specialist: preferred.specialist ?? fallback.specialist,
      lastActivity: preferred.lastActivity ?? fallback.lastActivity,
    };
  }

  function mergeAgentInfo(...agentGroups: WorkspaceAgentInfo[][]) {
    const agentIds: string[] = [];
    const agentsById = new Map<string, WorkspaceAgentInfo>();

    for (const agents of agentGroups) {
      for (const agent of agents) {
        const existingAgent = agentsById.get(agent.id);
        if (existingAgent) {
          agentsById.set(agent.id, mergeAgentFields(existingAgent, agent));
          continue;
        }

        agentIds.push(agent.id);
        agentsById.set(agent.id, agent);
      }
    }

    return agentIds.map((agentId) => agentsById.get(agentId)!);
  }

  // Subscribe to unread state via Redux selector for reactivity
  const unreadAgentIds$ = selectUnreadAgentIds();
  const workspaceAgentSessions$ = selectAllWorkspaceAgents(workspaceIdStore);

  // Reactive version counter for active streams (non-Redux service)
  let activeStreamsVersion = $state(0);

  onMount(() => {
    const unsubStreams = activeStreamsTracker.subscribe(() => activeStreamsVersion++);
    return () => {
      unsubStreams();
    };
  });

  // Check if there are line changes
  let hasChanges = $derived(
    Boolean(lineStats && (lineStats.additions > 0 || lineStats.deletions > 0)),
  );

  // Get streaming and unread agent IDs for this workspace
  let streamingAgentIds = $derived.by(() => {
    void activeStreamsVersion;
    return workspace ? activeStreamsTracker.getStreamingAgentIdsForWorkspace(workspace.id) : [];
  });

  let unreadAgentIds = $derived.by(() => {
    void $unreadAgentIds$; // triggers re-evaluation on unread state changes
    return workspace
      ? selectUnreadAgentIdsForWorkspace.select(getReduxStore().getState(), workspace.id)
      : [];
  });

  // Filter out streaming agents from unread list
  let unreadOnlyAgentIds = $derived(unreadAgentIds.filter((id) => !streamingAgentIds.includes(id)));

  // Format last activity time using shared workspace display recency semantics.
  let lastActivityText = $derived(
    !workspace
      ? 'No recent activity'
      : (() => {
          const activityDate = getWorkspaceActivityDisplayTime(workspace);
          return formatRelativeDate(activityDate) ?? 'No recent activity';
        })(),
  );

  // Get repository display name
  let repoDisplayName = $derived(
    !workspace
      ? 'Loading...'
      : workspace?.repositoryName
        ? workspace.repositoryOwner
          ? `${workspace.repositoryOwner}/${workspace.repositoryName}`
          : workspace.repositoryName
        : 'Local repository',
  );

  let statusMessage = $derived(workspace?.statusMessage?.trim());

  let lifecycleText = $derived.by(() => {
    if (!workspace) return null;
    if (workspace.archived || workspace.status === WorkspaceStatusEnum.Archived) {
      const archivedAt = formatRelativeDate(workspace.archivedAt);
      return archivedAt ? `Archived ${archivedAt}` : 'Archived';
    }
    return null;
  });

  let activeAgentIdSet = $derived.by(() => new Set([...activeAgentIds, ...streamingAgentIds]));

  let loadedAgentInfos = $derived($workspaceAgentSessions$.map(sessionToAgentInfo));

  let hoverAgentInfos = $derived.by(() => {
    const summaryAgents = workspace?.agentSummary?.agents ?? [];
    // Live Redux session data takes precedence over the on-disk agentSummary
    // snapshot, which is rebuilt asynchronously by the main process and can
    // lag behind real-time agent status transitions.
    const knownAgents = mergeAgentInfo(loadedAgentInfos, summaryAgents);
    const knownAgentIds = new Set(knownAgents.map((agent) => agent.id));
    const activePlaceholders = [...activeAgentIdSet]
      .filter((agentId) => !knownAgentIds.has(agentId))
      .map((agentId) => ({ id: agentId, name: 'Agent', status: 'running' }));

    return mergeAgentInfo(knownAgents, activePlaceholders);
  });

  let runningAgents = $derived.by(() => {
    return hoverAgentInfos.filter(
      (agent) => ACTIVE_AGENT_STATUSES.has(getAgentStatus(agent)) || activeAgentIdSet.has(agent.id),
    );
  });

  $effect(() => {
    const workspaceId = workspace?.id;
    if (!loadAgentSessions || !workspaceId) return;
    for (const agent of runningAgents.slice(0, 3)) {
      dispatch(ensureAgentSessionLoaded(String(workspaceId), agent.id));
    }
  });

  let streamingAgentIdsWithoutInfo = $derived.by(() => {
    const knownAgentIds = new Set(hoverAgentInfos.map((agent) => agent.id));
    return streamingAgentIds.filter((agentId) => !knownAgentIds.has(agentId));
  });

  let taskSummaryText = $derived(workspace ? formatTaskProgress(workspace.taskStats) : null);
  let taskProgressSegments = $derived(workspace ? buildTaskProgressSegments(workspace.taskStats) : []);

  let activePullRequest = $derived(getWorkspacePullRequest(workspace));
  let pullRequestDisplayStatus = $derived(
    getPullRequestDisplayStatus(activePullRequest, workspace?.prStatus),
  );
  let pullRequestDetailsText = $derived(
    formatPullRequestDetails(activePullRequest, workspace?.prStatus),
  );

  let gitSummaryText = $derived(workspace ? formatGitSummary(workspace.gitSummary) : null);

  let changeSummaryText = $derived.by(() => {
    if (!workspace) return hasChanges && lineStats ? 'Changes' : null;
    const summary = workspace.diffSummary;
    if (summary && summary.totalFiles > 0) {
      return `${pluralize(summary.totalFiles, 'file')} +${summary.totalAdditions} -${summary.totalDeletions}`;
    }
    if (hasChanges && lineStats) return `Local changes +${lineStats.additions} -${lineStats.deletions}`;
    return null;
  });

  let changeSummaryLineText = $derived.by(() => {
    const parts = [changeSummaryText, gitSummaryText].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : null;
  });
</script>

<div class="bg-popover shadow-2xl ring-1 ring-border/70 py-3 px-4 w-[320px] shrink-0 max-w-[calc(100vw-1rem)] flex flex-col gap-1.5 text-left">
  <!-- Header: Title and repo -->
  <div class="w-full">
    {#if isLoading || !workspace}
      <Skeleton class="h-5 w-40" />
    {:else}
      <div class="flex items-start gap-2">
        <div class="min-w-0 flex-1">
          <div class="text-sm font-semibold text-foreground truncate">
            {workspace?.title || 'Untitled'}
          </div>
        </div>
        {#if lifecycleText}
          <div
            class="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[0.65rem] font-medium text-subtle"
          >
            {lifecycleText}
          </div>
        {/if}
      </div>
      <div class="w-full flex items-center -mt-0.5 gap-1">
        <div
          class="flex-1 text-muted-foreground text-sm truncate text-left bg-transparent border-none p-0 font-inherit"
        >
          {repoDisplayName}
        </div>
      </div>
      {#if taskSummaryText}
        <div class="mt-2 flex flex-col gap-1.5">
          <div class="flex h-2.5 w-full gap-px rounded-xs overflow-hidden" aria-label="Workspace task progress">
            {#each taskProgressSegments as segment, index (`${segment.label}-${index}`)}
              <div
                class="min-w-[3px] flex-1 {getTaskStatusColor(segment.status)}"
                style="flex: {segment.weight} 1 0%;"
                title={segment.label}
              ></div>
            {/each}
          </div>
        </div>
      {/if}
      {#if statusMessage}
        <div
          class="mt-2 w-full text-sm text-subtle bg-transparent border-none px-0.5 pt-1 text-left break-words whitespace-pre-wrap transition-all duration-150 leading-snug"
        >
          {statusMessage}
        </div>
      {/if}
    {/if}
  </div>

  {#if !isLoading && workspace}
    <div class="grid gap-1.5 text-xs text-subtle">

      {#if runningAgents.length > 0}
        <div class="mt-1 flex w-full min-w-0 flex-col pb-2">
          <div class="-mx-1 min-w-0 w-full flex flex-col" role="list" aria-label="Running agents">
            {#each runningAgents.slice(0, 3) as agent (agent.id)}
              <div
                class="flex min-h-6 items-center justify-between gap-2 px-1.75 py-0.25 text-left min-w-0 w-full"
                role="listitem"
                aria-label={`${agent.name} ${formatRunningAgentMetadata(agent)}`}
              >
                <div class="flex-1 flex min-w-0 flex-1 items-center gap-2">
                  <span class="grid h-6 w-6 shrink-0 place-items-center">
                    <AugieAvatarWithState
                      agentId={agent.id}
                      size={20}
                      state={getRunningAgentAvatarState(agent)}
                      specialist={agent.specialist as BuiltinSpecialistId | null}
                    />
                  </span>
                  <span class="min-w-0 truncate text-sm font-medium leading-5 text-foreground">
                    {agent.name}
                  </span>
                </div>
              </div>
            {/each}
            {#if runningAgents.length > 3}
              <div class="px-1.75 pt-0.75 text-ui text-subtle font-medium">
                +{runningAgents.length - 3} more
              </div>
            {/if}
          </div>
        </div>
      {/if}

      {#if streamingAgentIdsWithoutInfo.length > 0 || unreadOnlyAgentIds.length > 0}
        <div class="flex items-center -space-x-1 py-1">
          {#each streamingAgentIdsWithoutInfo.slice(0, 3) as agentId (agentId)}
            <AugieAvatarWithState {agentId} size={16} state="running" />
          {/each}
          {#each unreadOnlyAgentIds.slice(0, Math.max(0, 3 - streamingAgentIdsWithoutInfo.length)) as agentId (agentId)}
            <AugieAvatarWithState {agentId} size={16} state="unread" />
          {/each}
        </div>
      {/if}

      {#if activePullRequest}
        <div class="relative min-w-0 -mx-1 flex w-full items-center gap-2 px-1 py-0.5" aria-label="Pull request">
          <Fa
            icon={getPullRequestStatusIcon(pullRequestDisplayStatus)}
            size="xs"
            class="{getPullRequestStatusColor(pullRequestDisplayStatus)} shrink-0"
          />
          <span class="flex min-w-0 flex-1 items-center gap-2 text-left">
            <span class="min-w-0 flex-1 truncate text-sm text-foreground">
              {activePullRequest.title || 'Pull request'}
            </span>
            {#if activePullRequest.number}
              <span class="shrink-0 text-ui text-subtle">#{activePullRequest.number}</span>
            {/if}
            {#if pullRequestDetailsText}
              <span
                class="max-w-28 shrink-0 truncate text-right text-ui font-medium {getPullRequestDetailsColor(
                  activePullRequest,
                  pullRequestDisplayStatus,
                )}"
              >
                {pullRequestDetailsText}
              </span>
            {/if}
          </span>
        </div>
      {/if}

      {#if changeSummaryLineText}
        <div
          class="-mx-1 flex w-full min-w-0 items-center px-1 py-0.5"
          aria-label="Workspace changes"
        >
          <span class="min-w-0 truncate text-sm font-medium leading-5 text-foreground">
            {changeSummaryLineText}
          </span>
        </div>
      {/if}


      <div class="flex items-center justify-between gap-3">
        <span class="min-w-0 truncate text-right">Last updated {lastActivityText}</span>
      </div>
    </div>
  {:else if isLoading}
    <div class="grid gap-1.5">
      <Skeleton class="h-4 w-48" />
      <Skeleton class="h-4 w-36" />
    </div>
  {/if}
</div>

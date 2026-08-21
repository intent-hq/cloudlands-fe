<script lang="ts">
  import type {
    AgentSession,
    PullRequestInfo,
    Workspace,
    WorkspaceAgentInfo,
    WorkspaceGitSummary,
  } from '$shared/types';
  import { WorkspaceStatusEnum } from '$shared/types';
  import { formatDistanceToNow } from '$lib/i18n/format';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import AgentAvatarWithState from '$features/agent/components/agent-avatar/AgentAvatarWithState.svelte';
  import AgentAvatarStack, {
    type AgentAvatarStackItem,
  } from '$features/agent/components/agent-avatar/AgentAvatarStack.svelte';
  import type { AvatarState } from '$features/agent/components/agent-avatar/avatar-state';
  import type { BuiltinSpecialistId } from '$lib/constants/specialists';
  import { activeStreamsTracker } from '$features/agent/services/active-streams-tracker';
  import { onMount } from 'svelte';
  import { writable } from 'svelte/store';
  import Fa from 'svelte-fa';
  import { selectAllWorkspaceAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import { ensureAgentSessionLoaded } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import {
    selectWorkspaceTaskDisplayList,
    selectWorkspaceTaskProgress,
    selectWorkspaceTasksInitialized,
  } from '$store/renderer/slices/workspace-tasks/workspace-tasks-selectors';
  import { ensureWorkspaceTasksLoaded } from '$store/renderer/slices/workspace-tasks/workspace-tasks-slice';
  import {
    selectWorkspaceDiffSummary,
    selectWorkspaceGitSummary,
  } from '$store/renderer/slices/workspace-summaries/workspace-summaries-selectors';
  import { loadWorkspaceSummariesRequested } from '$store/renderer/slices/workspace-summaries/workspace-summaries-slice';
  import { selectWorkspaceActivePullRequest } from '$store/renderer/slices/workspace/workspace-selectors';
  import { selectPrMonitors } from '$store/renderer/slices/pr-monitor/pr-monitor-selectors';

  import { getWorkspaceActivityDisplayTime } from '$shared/utils/workspace-activity-time';
  import { store as appStore } from '$store/renderer/store';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import TaskStatusProgress from './TaskStatusProgress.svelte';
  import WorkspaceStatusIcon from './WorkspaceStatusIcon.svelte';
  import { constructPrUrl } from './sidebar/sidebar-changes-utils';
  import {
    buildWorkspacePRPresentationModel,
    type WorkspacePRPresentationRow,
  } from './sidebar/workspace-pr-presentation';
  import {
    getWorkspaceStatusPresentation,
    resolveWorkspaceStatusState,
  } from './utils/workspace-status-presentation';

  interface Props {
    workspace: Workspace | null;
    lineStats?: { additions: number; deletions: number };
    isLoading?: boolean;
    activeAgentIds?: string[];
    /** Keep true in production; sandbox routes can disable session restoration/fetching. */
    loadAgentSessions?: boolean;
    /** Keep true in production; sandbox routes can disable on-demand task/summary fetching. */
    loadWorkspaceData?: boolean;
  }

  let {
    workspace,
    lineStats,
    isLoading = false,
    activeAgentIds = [],
    loadAgentSessions = true,
    loadWorkspaceData = true,
  }: Props = $props();

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
      return formatDistanceToNow(parsed);
    } catch {
      return 'Recently';
    }
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
      title: m.workspace_hoverCard_pullRequest_label(),
      status: workspace.prStatus,
      createdAt: workspace.updatedAt,
      updatedAt: workspace.updatedAt,
    };
  }

  function formatGitSummary(summary: WorkspaceGitSummary | null) {
    if (!summary) return null;

    if (summary.ahead > 0 && summary.behind > 0) {
      return `+${summary.ahead} -${summary.behind}`;
    }
    if (summary.ahead > 0) return `${pluralize(summary.ahead, 'commit')} ahead remote`;
    if (summary.behind > 0) return `${pluralize(summary.behind, 'commit')} behind remote`;
    if (summary.hasUnpushed) return m.workspace_hoverCard_unpushedCommits_label();
    return null;
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
      name: session.name || m.workspace_fileChanges_agent_label(),
      status: session.isStreaming
        ? 'streaming'
        : session.isProcessing
          ? 'processing'
          : session.status,
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

  const workspaceAgentSessions$ = selectAllWorkspaceAgents(workspaceIdStore);
  const workspaceTaskProgress$ = selectWorkspaceTaskProgress(workspaceIdStore);
  const workspaceTaskDisplayList$ = selectWorkspaceTaskDisplayList(workspaceIdStore);
  const workspaceTasksInitialized$ = selectWorkspaceTasksInitialized(workspaceIdStore);
  const workspaceDiffSummary$ = selectWorkspaceDiffSummary(workspaceIdStore);
  const workspaceGitSummary$ = selectWorkspaceGitSummary(workspaceIdStore);
  const prMonitors$ = selectPrMonitors(workspaceIdStore);

  // Fetch on-demand task/summary data when the hovered workspace changes.
  $effect(() => {
    const workspaceId = workspace?.id;
    if (!loadWorkspaceData || !workspaceId) return;
    appStore.dispatch(loadWorkspaceSummariesRequested(String(workspaceId)));
    appStore.dispatch(ensureWorkspaceTasksLoaded(String(workspaceId)));
  });

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

  // Attention is workspace-level (BE-owned); treat all member agents as unread.
  let unreadAgentIds = $derived(
    workspace?.attention === 'unread' ? (workspace.agentSummary?.agentIds ?? []) : [],
  );

  // Filter out streaming agents from unread list
  let unreadOnlyAgentIds = $derived(unreadAgentIds.filter((id) => !streamingAgentIds.includes(id)));

  // Format last activity time using shared workspace display recency semantics.
  let lastActivityText = $derived(
    !workspace
      ? m.workspace_hoverCard_noRecentActivity_label()
      : (() => {
          const activityDate = getWorkspaceActivityDisplayTime(workspace);
          return formatRelativeDate(activityDate) ?? m.workspace_hoverCard_noRecentActivity_label();
        })(),
  );

  // Get repository display name
  let repoDisplayName = $derived(
    !workspace
      ? m.workspace_hoverCard_loading_label()
      : workspace?.repositoryName
        ? workspace.repositoryOwner
          ? `${workspace.repositoryOwner}/${workspace.repositoryName}`
          : workspace.repositoryName
        : m.workspace_hoverCard_localRepository_label(),
  );

  let statusMessage = $derived(workspace?.statusMessage?.trim());
  let workspaceStatusState = $derived(resolveWorkspaceStatusState(workspace ?? {}));
  let workspaceStatusPresentation = $derived(getWorkspaceStatusPresentation(workspaceStatusState));

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

  let memberAgentIds = $derived(workspace?.agentSummary?.agentIds ?? []);

  let hoverAgentInfos = $derived.by(() => {
    // The workspace payload carries member agent IDs only; live Redux session
    // data provides names/statuses, with idle placeholders for sessions that
    // have not loaded yet.
    const memberPlaceholders = memberAgentIds.map((agentId) => ({
      id: agentId,
      name: 'Agent',
      status: 'idle',
    }));
    const knownAgents = mergeAgentInfo(loadedAgentInfos, memberPlaceholders);
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

  let sessionLoadWorkspaceId: string | null = null;
  let relevantAgentSessionIds = new Set<string>();

  $effect(() => {
    const workspaceId = workspace?.id;
    if (!loadAgentSessions || !workspaceId) {
      sessionLoadWorkspaceId = null;
      relevantAgentSessionIds = new Set();
      return;
    }

    const workspaceIdString = String(workspaceId);
    if (sessionLoadWorkspaceId !== workspaceIdString) {
      sessionLoadWorkspaceId = workspaceIdString;
      relevantAgentSessionIds = new Set();
    }

    // Member sessions provide real names/statuses for IDs-only summaries.
    const nextRelevantAgentSessionIds = new Set([
      ...memberAgentIds.slice(0, 6).map(String),
      ...runningAgents.slice(0, 3).map((agent) => String(agent.id)),
    ]);
    for (const agentId of nextRelevantAgentSessionIds) {
      if (!relevantAgentSessionIds.has(agentId)) {
        appStore.dispatch(ensureAgentSessionLoaded(workspaceIdString, agentId));
      }
    }
    relevantAgentSessionIds = nextRelevantAgentSessionIds;
  });

  let streamingAgentIdsWithoutInfo = $derived.by(() => {
    const knownAgentIds = new Set(hoverAgentInfos.map((agent) => agent.id));
    return streamingAgentIds.filter((agentId) => !knownAgentIds.has(agentId));
  });
  let hoverCardStackItems = $derived([
    ...streamingAgentIdsWithoutInfo.map((agentId): AgentAvatarStackItem => ({
      key: `running:${agentId}`,
      agentId,
      state: 'running',
    })),
    ...unreadOnlyAgentIds.map((agentId): AgentAvatarStackItem => ({
      key: `unread:${agentId}`,
      agentId,
      state: 'unread',
    })),
  ]);

  let taskStatuses = $derived(
    workspace ? $workspaceTaskDisplayList$.map((task) => task.status) : [],
  );
  let taskProgressRatio = $derived.by(() => {
    if (!workspace || $workspaceTaskProgress$.total === 0) return 0;
    return $workspaceTaskProgress$.completed / $workspaceTaskProgress$.total;
  });

  let activePullRequest = $derived.by(() => {
    if (!workspace) return null;
    return (
      selectWorkspaceActivePullRequest.select(appStore.state, workspace.id) ??
      getWorkspacePullRequest(workspace)
    );
  });
  let workspacePrRows = $derived.by(() => {
    if (!workspace) return [];
    const ws = workspace;
    const workspaceRepo =
      ws.repositoryOwner && ws.repositoryName
        ? `${ws.repositoryOwner}/${ws.repositoryName}`
        : undefined;
    return buildWorkspacePRPresentationModel({
      workspacePRs: ws.pullRequests,
      activePR: activePullRequest,
      monitors: $prMonitors$,
      workspaceRepo,
      buildPrUrl: (prNum, fallbackUrl) =>
        constructPrUrl(prNum, ws.repositoryOwner, ws.repositoryName, fallbackUrl),
      getDisplayTitle: (pr) => pr.title,
    });
  });

  function getWorkspacePrLabel(pr: WorkspacePRPresentationRow): string {
    const identity = pr.repo
      ? m.workspace_card_prBadge_repoLine_tooltip({ repo: pr.repo, number: pr.number })
      : m.workspace_card_prBadge_label({ number: ` #${pr.number}` });
    return [identity, pr.title, pr.details].filter(Boolean).join('\n');
  }

  let gitSummaryText = $derived(workspace ? formatGitSummary($workspaceGitSummary$) : null);

  let changeSummaryText = $derived.by(() => {
    if (!workspace)
      return hasChanges && lineStats ? m.workspace_multiSelectSidebar_changesTab_label() : null;
    const summary = $workspaceDiffSummary$;
    if (summary && summary.totalFiles > 0) {
      return `${pluralize(summary.totalFiles, 'file')} +${summary.totalAdditions} -${summary.totalDeletions}`;
    }
    if (hasChanges && lineStats)
      return m.workspace_hoverCard_localChanges_label({
        additions: lineStats.additions,
        deletions: lineStats.deletions,
      });
    return null;
  });

  let changeSummaryLineText = $derived.by(() => {
    const parts = [changeSummaryText, gitSummaryText].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : null;
  });
</script>

<div
  class="bg-popover shadow-(--elevation-overlay) ring-1 ring-border/70 py-3 px-4 w-[320px] shrink-0 max-w-[calc(100vw-1rem)] flex flex-col gap-1.5 text-left"
>
  <!-- Header: Title and repo -->
  <div class="w-full" data-workspace-hover-card-header>
    {#if isLoading || !workspace}
      <Skeleton class="h-5 w-40" />
    {:else}
      <div class="flex items-start gap-2" data-workspace-hover-card-title-row>
        <div class="min-w-0 flex-1">
          <div class="text-sm font-semibold text-foreground truncate">
            {workspace?.title || m.workspace_links_untitled_label()}
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
      <div class="w-full flex items-center -mt-0.5 gap-1" data-workspace-hover-card-repo-row>
        <div
          class="flex-1 text-muted-foreground text-sm truncate text-left bg-transparent border-none p-0 font-inherit"
        >
          {repoDisplayName}
        </div>
      </div>
      <div
        class="mt-1 flex w-full min-w-0 items-center gap-2 text-sm text-muted-foreground"
        data-workspace-hover-card-status-row
      >
        <WorkspaceStatusIcon status={workspaceStatusState} size={14} decorative />
        <span class="min-w-0 truncate">{workspaceStatusPresentation.label}</span>
      </div>
      <div class="mt-2 min-w-0" data-workspace-hover-card-progress>
        <TaskStatusProgress
          statuses={taskStatuses}
          progress={taskProgressRatio}
          loading={!$workspaceTasksInitialized$}
          animationKey={String(workspace.id)}
          ariaLabel={m.workspace_hoverCard_taskProgress_ariaLabel()}
          size="compact"
          fallback={$workspaceTaskProgress$}
        />
      </div>
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
          <div
            class="-mx-1 min-w-0 w-full flex flex-col"
            role="list"
            aria-label={m.workspace_hoverCard_runningAgents_ariaLabel()}
          >
            {#each runningAgents.slice(0, 3) as agent (agent.id)}
              <div
                class="flex min-h-6 items-center justify-between gap-2 px-1.75 py-0.25 text-left min-w-0 w-full"
                role="listitem"
                aria-label={`${agent.name} ${formatRunningAgentMetadata(agent)}`}
              >
                <div class="flex-1 flex min-w-0 flex-1 items-center gap-2">
                  <span class="grid h-6 w-6 shrink-0 place-items-center">
                    <AgentAvatarWithState
                      agentId={agent.id}
                      variant="standard"
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
                {m.workspace_hoverCard_moreAgents_label({
                  count: formatInteger(runningAgents.length - 3),
                })}
              </div>
            {/if}
          </div>
        </div>
      {/if}

      {#if hoverCardStackItems.length > 0}
        <div
          class="flex items-center py-1 pl-[var(--agent-avatar-emphasized-ring-width)] pr-[var(--agent-avatar-emphasized-ring-width)]"
          data-workspace-hover-card-agent-stack
        >
          <AgentAvatarStack items={hoverCardStackItems} />
        </div>
      {/if}

      {#if workspacePrRows.length > 0}
        <div
          class="-mx-1 grid min-w-0 w-full gap-1 px-1 py-0.5"
          aria-label={m.workspace_hoverCard_pullRequest_label()}
          role="list"
          data-workspace-hover-card-pr-list
        >
          {#each workspacePrRows as pr (pr.identity)}
            <div
              class="grid min-w-0 grid-cols-[1.25rem_minmax(0,1fr)] gap-x-1.5 rounded-sm px-0.5 py-0.5"
              aria-label={getWorkspacePrLabel(pr)}
              role="listitem"
              data-workspace-hover-card-pr-row
              data-pr-identity={pr.identity}
              data-pr-status={pr.status}
            >
              <span
                class="row-span-2 inline-flex size-5 items-center justify-center rounded-sm {pr.backgroundClass} {pr.foregroundClass}"
                aria-hidden="true"
              >
                <Fa icon={pr.statusIcon} size="xs" />
              </span>
              <span class="flex min-w-0 items-center gap-2 text-left">
                <span class="min-w-0 flex-1 truncate text-sm text-foreground">
                  {pr.title || m.workspace_hoverCard_pullRequest_label()}
                </span>
                <span class="shrink-0 text-ui text-subtle">#{pr.number}</span>
              </span>
              <span class="flex min-w-0 items-center gap-1.5 text-ui">
                {#if pr.repoContext}
                  <span class="max-w-24 shrink-0 truncate text-subtle">{pr.repoContext}</span>
                {/if}
                <span class="min-w-0 truncate font-medium {pr.foregroundClass}">
                  {pr.details.replaceAll('\n', ' · ')}
                </span>
              </span>
            </div>
          {/each}
        </div>
      {/if}

      {#if changeSummaryLineText}
        <div
          class="-mx-1 flex w-full min-w-0 items-center px-1 py-0.5"
          aria-label={m.workspace_hoverCard_changes_ariaLabel()}
        >
          <span class="min-w-0 truncate text-sm font-medium leading-5 text-foreground">
            {changeSummaryLineText}
          </span>
        </div>
      {/if}

      <div class="flex items-center justify-between gap-3">
        <span class="min-w-0 truncate text-right"
          >{m.workspace_hoverCard_lastUpdated_label({ time: lastActivityText })}</span
        >
      </div>
    </div>
  {:else if isLoading}
    <div class="grid gap-1.5">
      <Skeleton class="h-4 w-48" />
      <Skeleton class="h-4 w-36" />
    </div>
  {/if}
</div>

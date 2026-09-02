<script lang="ts">
  import AgentAvatarWithState from '$features/agent/components/agent-avatar/AgentAvatarWithState.svelte';
  import type { AvatarState } from '$features/agent/components/agent-avatar/avatar-state';
  import { activeStreamsTracker } from '$features/agent/services/active-streams-tracker';
  import { derivePendingQuestions } from '$lib/components/chat/questions/pending-questions';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import TaskStatusProgress from '$lib/components/workspace/TaskStatusProgress.svelte';
  import type { BuiltinSpecialistId } from '$lib/constants/specialists';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import type { AgentSession, PullRequestInfo, Workspace } from '$shared/types';
  import { getAgentAttentionRequest } from '$shared/utils/agent-attention';
  import { onMount } from 'svelte';
  import { writable } from 'svelte/store';
  import Fa from 'svelte-fa';
  import {
    selectAgentPreview,
    type AgentPreview,
  } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import {
    selectWorkspaceTaskDisplayList,
    selectWorkspaceTaskProgress,
    selectWorkspaceTasksInitialized,
  } from '$store/renderer/slices/workspace-tasks/workspace-tasks-selectors';
  import { ensureWorkspaceTasksLoaded } from '$store/renderer/slices/workspace-tasks/workspace-tasks-slice';
  import { selectAllWorkspaceAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import { ensureAgentSessionLoaded } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import { store as appStore } from '$store/renderer/store';
  import { selectPrMonitors } from '$store/renderer/slices/pr-monitor/pr-monitor-selectors';
  import { selectWorkspaceActivePullRequest } from '$store/renderer/slices/workspace/workspace-selectors';
  import WorkspaceStatusIcon from './WorkspaceStatusIcon.svelte';
  import { constructPrUrl } from './sidebar/sidebar-changes-utils';
  import {
    buildWorkspacePRPresentationModel,
    type WorkspacePRPresentationRow,
  } from './sidebar/workspace-pr-presentation';
  import { formatWorkspaceHoverCardTimestamp } from './workspace-hover-card-time';
  import {
    getWorkspaceStatusPresentation,
    resolveWorkspaceStatusState,
  } from './utils/workspace-status-presentation';

  interface Props {
    workspace: Workspace | null;
    lineStats?: { additions: number; deletions: number };
    isLoading?: boolean;
    activeAgentIds?: string[];
    loadAgentSessions?: boolean;
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
  $effect(() => {
    void lineStats;
  });
  const workspaceIdStore = writable('');
  const workspaceAgents$ = selectAllWorkspaceAgents(workspaceIdStore);
  const workspaceTaskDisplayList$ = selectWorkspaceTaskDisplayList(workspaceIdStore);
  const workspaceTaskProgress$ = selectWorkspaceTaskProgress(workspaceIdStore);
  const workspaceTasksInitialized$ = selectWorkspaceTasksInitialized(workspaceIdStore);
  const prMonitors$ = selectPrMonitors(workspaceIdStore);
  $effect(() => workspaceIdStore.set(workspace?.id ?? ''));
  $effect(() => {
    if (workspace && loadWorkspaceData) {
      const id = String(workspace.id);
      appStore.dispatch(ensureWorkspaceTasksLoaded(id));
    }
  });
  let streamsVersion = $state(0);
  onMount(() => activeStreamsTracker.subscribe(() => streamsVersion++));
  let memberAgentIds = $derived(workspace?.agentSummary?.agentIds ?? []);
  let streamingAgentIds = $derived.by(() => {
    void streamsVersion;
    return workspace ? activeStreamsTracker.getStreamingAgentIdsForWorkspace(workspace.id) : [];
  });
  let loadedWorkspace: string | null = null;
  let requestedIds = new Set<string>();
  $effect(() => {
    if (!workspace || !loadAgentSessions) return;
    const id = String(workspace.id);
    if (loadedWorkspace !== id) {
      loadedWorkspace = id;
      requestedIds = new Set();
    }
    for (const agentId of new Set([
      ...memberAgentIds.slice(0, 6),
      ...activeAgentIds,
      ...streamingAgentIds,
    ])) {
      if (!requestedIds.has(agentId)) {
        appStore.dispatch(ensureAgentSessionLoaded(id, agentId));
        requestedIds.add(agentId);
      }
    }
  });

  type RowGroup = 'attention' | 'active' | 'waiting';
  interface AgentRow {
    id: string;
    name: string;
    group: RowGroup;
    attentionKind?: string;
    avatarState: AvatarState;
    specialist?: BuiltinSpecialistId;
    context: string;
    questionMeta?: {
      compact: string;
      accessible: string;
    };
    contextIsPreview: boolean;
    updated: {
      compact: string;
      accessible: string;
      dateTime?: string;
    };
    priority: number;
  }
  function rowAccessibleLabel(row: AgentRow) {
    return [row.name, row.context, row.questionMeta?.accessible, row.updated.accessible]
      .filter(Boolean)
      .join('. ');
  }
  function previewText(preview: AgentPreview | null) {
    if (!preview) return null;
    if (preview.kind === 'attention') return preview.attention.reason?.trim() || null;
    return 'text' in preview ? preview.text.trim() || null : null;
  }
  function relativeTime(session: AgentSession) {
    return (
      formatWorkspaceHoverCardTimestamp(
        session.lastActivity || session.updatedAt || session.createdAt,
      ) ?? {
        compact: '—',
        accessible: m.workspace_hoverCard_noRecentActivity_label(),
      }
    );
  }
  function rowFor(session: AgentSession): AgentRow | null {
    const status = String(session.status).toLowerCase();
    const attention = getAgentAttentionRequest(session);
    const marker = session.metadata?.pendingQuestionsMessageId;
    const pending = derivePendingQuestions(
      session.messages,
      false,
      false,
      typeof marker === 'string' ? marker : undefined,
    );
    const hasQuestion = pending !== null || (typeof marker === 'string' && marker.length > 0);
    const preview = previewText(selectAgentPreview.select(appStore.state, String(session.id)));
    let group: RowGroup;
    let attentionKind: string | undefined;
    let context: string;
    let avatarState: AvatarState;
    let priority: number;
    let questionMeta: AgentRow['questionMeta'];
    let contextIsPreview = false;
    if (attention?.kind === 'blocker' || status === 'blocked') {
      group = 'attention';
      attentionKind = 'blocker';
      context = attention?.reason?.trim() || m.chat_agentCard_attentionBlocker_label();
      avatarState = 'attention-blocker';
      priority = 0;
    } else if (hasQuestion) {
      group = 'attention';
      attentionKind = 'question';
      context =
        pending?.questions[0]?.question.trim() || preview || m.workspace_hoverCard_question_label();
      avatarState = 'question';
      priority = 1;
      const count = pending?.questions.length ?? 0;
      if (count > 1) {
        questionMeta = {
          compact: `${formatInteger(1)}/${formatInteger(count)}`,
          accessible: `${m.workspace_hoverCard_question_label()} ${m.chat_questionWizard_stepCounter_label({ current: 1, total: count })}`,
        };
      }
    } else if (attention?.kind === 'discussion') {
      group = 'attention';
      attentionKind = 'discussion';
      context = attention.reason?.trim() || m.chat_agentCard_attentionDiscussion_label();
      avatarState = 'attention-discussion';
      priority = 1;
    } else if (session.hasUnread) {
      group = 'attention';
      attentionKind = 'unread';
      context = preview || m.chat_newMessagesDivider_label();
      contextIsPreview = Boolean(preview);
      avatarState = 'unread';
      priority = 2;
    } else if (
      session.isStreaming ||
      session.isProcessing ||
      activeAgentIds.includes(String(session.id)) ||
      streamingAgentIds.includes(String(session.id)) ||
      [
        'active',
        'busy',
        'processing',
        'responding',
        'running',
        'streaming',
        'in_progress',
      ].includes(status)
    ) {
      group = 'active';
      context = preview || m.workspace_devScripts_running_label();
      contextIsPreview = Boolean(preview);
      avatarState = session.isProcessing ? 'responding' : 'running';
      priority = 3;
    } else if (['waiting', 'pending', 'queued', 'starting'].includes(status)) {
      group = 'waiting';
      context = preview || m.workspace_taskStatus_waiting_label();
      contextIsPreview = Boolean(preview);
      avatarState = 'waiting';
      priority = 4;
    } else return null;
    const metadata = session.agentMetadata ?? session.metadata;
    return {
      id: String(session.id),
      name: session.name?.trim() || m.workspace_fileChanges_agent_label(),
      group,
      attentionKind,
      avatarState,
      specialist: metadata?.specialist as BuiltinSpecialistId | undefined,
      context,
      questionMeta,
      contextIsPreview,
      updated: relativeTime(session),
      priority,
    };
  }
  let eligibleSessions = $derived.by(() => {
    const summary = workspace?.agentSummary as { agents?: unknown } | undefined;
    const parents = new Map<string, unknown>();
    if (Array.isArray(summary?.agents))
      for (const item of summary.agents)
        if (item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string')
          parents.set(
            (item as { id: string }).id,
            (item as { parentAgentId?: unknown }).parentAgentId,
          );
    return $workspaceAgents$.filter((session) => {
      const metadata = session.agentMetadata ?? session.metadata ?? {};
      const parent = parents.get(String(session.id));
      return !(
        session.isBackground ||
        metadata.isBackground ||
        metadata.createdByAgentId ||
        (typeof parent === 'string' && parent) ||
        session.pendingDeleteAt ||
        session.retiredAt ||
        String(session.status).toLowerCase() === 'deleted'
      );
    });
  });
  let allRows = $derived(
    eligibleSessions
      .map(rowFor)
      .filter((row): row is AgentRow => row !== null)
      .sort((a, b) => a.priority - b.priority),
  );
  let visibleRows = $derived(allRows.slice(0, 6));
  let hiddenCount = $derived(Math.max(0, allRows.length - 6));
  let groups = $derived([
    {
      key: 'attention' as const,
      label: m.workspace_statusIcon_needsAttention_label(),
      rows: visibleRows.filter((r) => r.group === 'attention'),
    },
    {
      key: 'active' as const,
      label: m.chat_chatHeader_statusActive_label(),
      rows: visibleRows.filter((r) => r.group === 'active'),
    },
    {
      key: 'waiting' as const,
      label: m.workspace_taskStatus_waiting_label(),
      rows: visibleRows.filter((r) => r.group === 'waiting'),
    },
  ]);
  let repo = $derived(
    workspace?.repositoryName
      ? workspace.repositoryOwner
        ? `${workspace.repositoryOwner}/${workspace.repositoryName}`
        : workspace.repositoryName
      : m.workspace_hoverCard_localRepository_label(),
  );
  let statusState = $derived(resolveWorkspaceStatusState(workspace ?? {}));
  let status = $derived(getWorkspaceStatusPresentation(statusState));
  let summary = $derived(workspace?.statusMessage?.trim() || status.label);
  let taskStatuses = $derived($workspaceTaskDisplayList$.map((task) => task.status));
  let hasTasks = $derived(taskStatuses.length > 0 || $workspaceTaskProgress$.total > 0);
  function getWorkspacePullRequest(value: Workspace | null): PullRequestInfo | null {
    if (!value) return null;
    const pr = value.activePullRequest ?? value.pullRequests?.[0] ?? null;
    if (pr) return pr;
    if (!value.prStatus) return null;
    return {
      id: `legacy-pr-${value.prNumber ?? 'workspace'}`,
      number: value.prNumber ?? 0,
      url: value.prUrl ?? '',
      title: m.workspace_hoverCard_pullRequest_label(),
      status: value.prStatus,
      createdAt: value.updatedAt,
      updatedAt: value.updatedAt,
    };
  }
  let activePullRequest = $derived.by(() => {
    if (!workspace) return null;
    return (
      selectWorkspaceActivePullRequest.select(appStore.state, workspace.id) ??
      getWorkspacePullRequest(workspace)
    );
  });
  let workspacePrRows = $derived.by(() => {
    if (!workspace) return [];
    const workspaceRepo =
      workspace.repositoryOwner && workspace.repositoryName
        ? `${workspace.repositoryOwner}/${workspace.repositoryName}`
        : undefined;
    return buildWorkspacePRPresentationModel({
      workspacePRs: workspace.pullRequests,
      activePR: activePullRequest,
      monitors: $prMonitors$,
      workspaceRepo,
      buildPrUrl: (prNumber, fallbackUrl) =>
        constructPrUrl(prNumber, workspace.repositoryOwner, workspace.repositoryName, fallbackUrl),
      getDisplayTitle: (pr) => pr.title,
    });
  });
  function getWorkspacePrLabel(pr: WorkspacePRPresentationRow): string {
    const identity = pr.repo
      ? m.workspace_card_prBadge_repoLine_tooltip({ repo: pr.repo, number: pr.number })
      : m.workspace_card_prBadge_label({ number: ` #${pr.number}` });
    return [identity, pr.title, pr.details].filter(Boolean).join('\n');
  }
</script>

<section
  class="workspace-hover-card shrink-0 overflow-hidden rounded-lg bg-popover text-left text-popover-foreground shadow-(--elevation-overlay) ring-1 ring-border"
  data-workspace-hover-card
  data-workspace-hover-card-layout="landscape"
>
  {#if isLoading || !workspace}<div class="grid gap-3 px-3.5 py-3">
      <div class="flex items-center justify-between gap-4">
        <Skeleton class="h-5 w-44" /><Skeleton class="h-4 w-36" />
      </div>
      <div class="body-grid grid min-w-0 grid-cols-2 gap-0">
        <div class="grid gap-2 pr-3.5">
          <Skeleton class="h-4 w-40" /><Skeleton class="h-9 w-full" />
        </div>
        <div class="border-l border-border pl-3.5"><Skeleton class="h-14 w-full" /></div>
      </div>
    </div>
  {:else}
    <header
      class="flex min-w-0 items-center gap-3 border-b border-border px-3.5 py-3"
      data-workspace-hover-card-header
    >
      <h2
        class="type-title min-w-0 flex-1 truncate text-base font-semibold text-foreground"
        data-workspace-hover-card-title
      >
        {workspace.title || m.workspace_links_untitled_label()}
      </h2>
      <div class="header-meta flex shrink-0 items-center gap-2.5">
        {#if hasTasks}<span class="task-progress w-20" data-workspace-hover-card-progress
            ><TaskStatusProgress
              statuses={taskStatuses}
              progress={$workspaceTaskProgress$.total > 0
                ? $workspaceTaskProgress$.completed / $workspaceTaskProgress$.total
                : 0}
              loading={!$workspaceTasksInitialized$}
              motion={false}
              ariaLabel={m.workspace_hoverCard_taskProgress_ariaLabel()}
              size="compact"
              fallback={$workspaceTaskProgress$}
            /></span
          >{/if}<span
          class="flex min-w-0 items-center gap-1.5 text-xs font-medium text-foreground"
          data-workspace-hover-card-status
          ><WorkspaceStatusIcon status={statusState} size={16} decorative /><span class="truncate"
            >{status.label}</span
          ></span
        >
      </div>
    </header>
    <div class="body-grid grid min-w-0 grid-cols-2" data-workspace-hover-card-columns>
      <section
        class="identity grid min-w-0 content-start gap-2.5 px-3.5 py-3"
        data-workspace-hover-card-identity
      >
        <div class="grid min-w-0 gap-1.5 text-xs text-muted-foreground">
          <span class="type-body min-w-0 truncate" data-workspace-hover-card-repo>{repo}</span>
        </div>
        <p
          class="type-body min-w-0 line-clamp-3 text-sm leading-snug text-subtle"
          title={summary}
          data-workspace-hover-card-summary
        >
          {summary}
        </p>
        {#if workspacePrRows.length}
          <div
            class="grid min-w-0 gap-1 pt-0.5"
            aria-label={m.workspace_hoverCard_pullRequest_label()}
            role="list"
            data-workspace-hover-card-pr-list
          >
            {#each workspacePrRows as pr (pr.identity)}
              <div
                class="grid min-w-0 grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-1.5"
                aria-label={getWorkspacePrLabel(pr)}
                role="listitem"
                data-workspace-hover-card-pr-row
                data-pr-identity={pr.identity}
                data-pr-status={pr.status}
              >
                <Fa icon={pr.statusIcon} size={12} class="shrink-0 {pr.foregroundClass}" />
                <span class="min-w-0 truncate text-xs font-medium text-foreground">
                  {pr.title || m.workspace_hoverCard_pullRequest_label()}
                </span>
                <span class="shrink-0 text-xs text-subtle">#{pr.number}</span>
                <span
                  class="col-start-2 col-end-4 min-w-0 truncate text-xs {pr.foregroundClass}"
                  data-workspace-hover-card-pr-status
                >
                  {pr.details.replaceAll('\n', ' · ')}
                </span>
              </div>
            {/each}
          </div>
        {/if}
      </section>
      <section
        class="activity min-w-0 border-l border-solid border-border"
        data-workspace-hover-card-activity
        data-workspace-hover-card-agent-table
      >
        {#if visibleRows.length}
          {#each groups as group (group.key)}{#if group.rows.length}<section
                aria-labelledby={`hover-${workspace.id}-${group.key}`}
                data-agent-group={group.key}
              >
                <h3
                  id={`hover-${workspace.id}-${group.key}`}
                  class="px-3 pb-0.5 pt-2 text-xs font-semibold uppercase tracking-wide text-subtle"
                >
                  {group.label}
                </h3>
                <div role="list">
                  {#each group.rows as row (row.id)}<div
                      class="agent-row grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-1.5 px-3"
                      role="listitem"
                      aria-label={rowAccessibleLabel(row)}
                      data-workspace-hover-card-agent-row
                      data-agent-group-row={group.key}
                      data-attention-kind={row.attentionKind}
                    >
                      <span class="grid h-5 w-5 place-items-center" aria-hidden="true"
                        ><AgentAvatarWithState
                          agentId={row.id}
                          variant="standard"
                          state={row.avatarState}
                          specialist={row.specialist ?? null}
                        /></span
                      ><span
                        class="max-w-24 truncate text-sm font-medium text-foreground"
                        data-workspace-hover-card-agent-name>{row.name}</span
                      ><time
                        class="whitespace-nowrap text-xs text-subtle"
                        datetime={row.updated.dateTime}
                        aria-label={row.updated.accessible}
                        data-workspace-hover-card-agent-time>{row.updated.compact}</time
                      >
                      <span
                        class="agent-detail flex min-w-0 items-start gap-1.5 text-xs leading-snug text-muted-foreground"
                        title={row.context}
                        data-workspace-hover-card-agent-detail
                        data-workspace-hover-card-agent-preview={row.contextIsPreview || undefined}
                        ><span
                          class="line-clamp-2 min-w-0 break-words"
                          data-workspace-hover-card-agent-context>{row.context}</span
                        >{#if row.questionMeta}<span
                            class="shrink-0 text-subtle"
                            aria-label={row.questionMeta.accessible}
                            data-workspace-hover-card-question-meta
                            ><span aria-hidden="true">{row.questionMeta.compact}</span></span
                          >{/if}</span
                      >
                    </div>{/each}
                </div>
              </section>{/if}{/each}{#if hiddenCount}<div
              class="px-3 pb-2 pt-1 text-xs font-medium text-subtle"
              data-workspace-hover-card-overflow
            >
              {m.workspace_hoverCard_moreAgents_label({ count: formatInteger(hiddenCount) })}
            </div>{/if}{/if}
      </section>
    </div>
  {/if}
</section>

<style>
  .workspace-hover-card {
    width: 36rem;
    max-width: min(100%, calc(100vw - 3.625rem));
    container-type: inline-size;
  }
  .agent-row {
    min-height: 34px;
    padding-block: 0.25rem;
  }
  .agent-detail {
    grid-column: 2 / -1;
  }
  [data-agent-group] + [data-agent-group] {
    margin-top: 0.125rem;
  }
  @container (max-width:30rem) {
    .body-grid {
      grid-template-columns: minmax(0, 1fr);
    }
    .activity {
      border-left-width: 0;
      border-top-width: 1px;
    }
    .task-progress {
      display: none;
    }
  }
  @container (max-width:28rem) {
    .agent-row {
      grid-template-columns: 1.5rem minmax(0, 1fr) auto;
    }
    .header-meta {
      gap: 0.5rem;
    }
  }
</style>

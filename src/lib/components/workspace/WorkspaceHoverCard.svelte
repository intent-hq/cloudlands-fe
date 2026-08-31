<script lang="ts">
  import AgentAvatarStack, {
    type AgentAvatarStackItem,
  } from '$features/agent/components/agent-avatar/AgentAvatarStack.svelte';
  import AgentAvatarWithState from '$features/agent/components/agent-avatar/AgentAvatarWithState.svelte';
  import type { AvatarState } from '$features/agent/components/agent-avatar/avatar-state';
  import { activeStreamsTracker } from '$features/agent/services/active-streams-tracker';
  import { derivePendingQuestions } from '$lib/components/chat/questions/pending-questions';
  import Skeleton from '$lib/components/ui/skeleton/skeleton.svelte';
  import TaskStatusProgress from '$lib/components/workspace/TaskStatusProgress.svelte';
  import type { BuiltinSpecialistId } from '$lib/constants/specialists';
  import { m } from '$shared/paraglide/messages.js';
  import { formatDistanceToNow, formatInteger } from '$lib/i18n/format';
  import type { AgentSession, Workspace } from '$shared/types';
  import { getAgentAttentionRequest } from '$shared/utils/agent-attention';
  import { onMount } from 'svelte';
  import { writable } from 'svelte/store';
  import {
    selectAgentPreview,
    type AgentPreview,
  } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import { loadWorkspaceSummariesRequested } from '$store/renderer/slices/workspace-summaries/workspace-summaries-slice';
  import {
    selectWorkspaceTaskDisplayList,
    selectWorkspaceTaskProgress,
    selectWorkspaceTasksInitialized,
  } from '$store/renderer/slices/workspace-tasks/workspace-tasks-selectors';
  import { ensureWorkspaceTasksLoaded } from '$store/renderer/slices/workspace-tasks/workspace-tasks-slice';
  import { selectAllWorkspaceAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import { ensureAgentSessionLoaded } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import { store as appStore } from '$store/renderer/store';
  import WorkspaceStatusIcon from './WorkspaceStatusIcon.svelte';
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
  $effect(() => workspaceIdStore.set(workspace?.id ?? ''));
  $effect(() => {
    if (workspace && loadWorkspaceData) {
      const id = String(workspace.id);
      appStore.dispatch(ensureWorkspaceTasksLoaded(id));
      appStore.dispatch(loadWorkspaceSummariesRequested(id));
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
    questionMeta?: string;
    updated: string;
    priority: number;
  }
  function previewText(preview: AgentPreview | null) {
    if (!preview) return null;
    if (preview.kind === 'attention') return preview.attention.reason?.trim() || null;
    return 'text' in preview ? preview.text.trim() || null : null;
  }
  function relativeTime(session: AgentSession) {
    return (
      formatDistanceToNow(session.lastActivity || session.updatedAt || session.createdAt) ||
      m.workspace_hoverCard_noRecentActivity_label()
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
    let questionMeta: string | undefined;
    if (attention?.kind === 'blocker' || status === 'blocked') {
      group = 'attention';
      attentionKind = 'blocker';
      context = attention?.reason?.trim() || m.chat_agentCard_attentionBlocker_label();
      avatarState = 'attention-blocker';
      priority = 0;
    } else if (hasQuestion) {
      group = 'attention';
      attentionKind = 'question';
      context = pending?.questions[0]?.question.trim() || m.hud_card_attnPending_label();
      avatarState = 'question';
      priority = 1;
      const count = pending?.questions.length ?? 0;
      if (count > 1)
        questionMeta = m.chat_questionWizard_stepCounter_label({ current: 1, total: count });
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
      avatarState = session.isProcessing ? 'responding' : 'running';
      priority = 3;
    } else if (['waiting', 'pending', 'queued', 'starting'].includes(status)) {
      group = 'waiting';
      context = preview || m.workspace_taskStatus_waiting_label();
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
  let headerAvatars = $derived(
    eligibleSessions.slice(0, 3).map((session): AgentAvatarStackItem => {
      const row = allRows.find((r) => r.id === String(session.id));
      return {
        key: String(session.id),
        agentId: String(session.id),
        state: row?.avatarState ?? 'idle',
        specialist: (session.agentMetadata ?? session.metadata)?.specialist as
          BuiltinSpecialistId | undefined,
      };
    }),
  );
  let agentCount = $derived(
    eligibleSessions.length === 1
      ? m.chat_toolDetails_agentCount_one({ count: formatInteger(1) })
      : m.chat_toolDetails_agentCount_many({ count: formatInteger(eligibleSessions.length) }),
  );
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
  let updated = $derived(
    workspace
      ? formatDistanceToNow(
          workspace.lastActivity || workspace.updatedAt || workspace.createdAt,
        ) || m.workspace_hoverCard_noRecentActivity_label()
      : '',
  );
  let taskStatuses = $derived($workspaceTaskDisplayList$.map((task) => task.status));
  let hasTasks = $derived(taskStatuses.length > 0 || $workspaceTaskProgress$.total > 0);
</script>

<section
  class="workspace-hover-card overflow-hidden rounded-md bg-background text-left shadow-(--elevation-overlay) ring-1 ring-border/70"
  data-workspace-hover-card
>
  {#if isLoading || !workspace}<div class="grid gap-2 px-3.5 py-3">
      <Skeleton class="h-5 w-44" /><Skeleton class="h-4 w-64" /><Skeleton class="h-10 w-full" />
    </div>
  {:else}
    <header class="grid gap-2.5 px-3.5 pb-3 pt-3" data-workspace-hover-card-header>
      <div class="flex min-w-0 items-center gap-3">
        <h2
          class="type-title min-w-0 flex-1 truncate text-base font-semibold text-foreground"
          data-workspace-hover-card-title
        >
          {workspace.title || m.workspace_links_untitled_label()}
        </h2>
        <div class="header-meta flex shrink-0 items-center gap-2.5">
          <span
            class="flex min-w-0 items-center gap-1 text-xs font-medium text-foreground"
            data-workspace-hover-card-status
            ><WorkspaceStatusIcon status={statusState} size={11} decorative /><span class="truncate"
              >{status.label}</span
            ></span
          >{#if hasTasks}<span class="task-progress w-20" data-workspace-hover-card-progress
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
            >{/if}<time
            class="updated whitespace-nowrap text-xs text-subtle"
            data-workspace-hover-card-timestamp>{updated}</time
          >
        </div>
      </div>
      <div class="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <span class="min-w-0 truncate font-mono" data-workspace-hover-card-repo>{repo}</span
        >{#if workspace.branch}<span
            class="max-w-36 shrink truncate rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] text-subtle"
            data-workspace-hover-card-branch>{workspace.branch}</span
          >{/if}{#if headerAvatars.length}<span
            class="ml-auto shrink-0 pl-1"
            data-workspace-hover-card-agent-stack><AgentAvatarStack items={headerAvatars} /></span
          >{/if}<span class="shrink-0 text-subtle" data-workspace-hover-card-agent-count
          >{agentCount}</span
        >
      </div>
      <p
        class="type-body min-w-0 truncate text-sm text-subtle"
        title={summary}
        data-workspace-hover-card-summary
      >
        {summary}
      </p>
    </header>
    {#if visibleRows.length}<div
        class="border-t border-border/70"
        data-workspace-hover-card-agent-table
      >
        {#each groups as group (group.key)}{#if group.rows.length}<section
              aria-labelledby={`hover-${workspace.id}-${group.key}`}
              data-agent-group={group.key}
            >
              <h3
                id={`hover-${workspace.id}-${group.key}`}
                class="bg-muted/45 px-3.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-subtle"
              >
                {group.label}
              </h3>
              <div role="list">
                {#each group.rows as row (row.id)}<div
                    class="agent-row grid min-w-0 grid-cols-[1.75rem_minmax(4rem,7rem)_minmax(0,1fr)_auto] items-center gap-2 border-t border-border/50 px-3.5"
                    role="listitem"
                    aria-label={`${row.name}. ${row.context}. ${row.updated}`}
                    data-workspace-hover-card-agent-row
                    data-agent-group-row={group.key}
                    data-attention-kind={row.attentionKind}
                  >
                    <span class="grid h-6 w-6 place-items-center" aria-hidden="true"
                      ><AgentAvatarWithState
                        agentId={row.id}
                        variant="standard"
                        state={row.avatarState}
                        specialist={row.specialist ?? null}
                      /></span
                    ><span
                      class="truncate text-sm font-medium text-foreground"
                      data-workspace-hover-card-agent-name>{row.name}</span
                    ><span class="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
                      ><span class="min-w-0 truncate" data-workspace-hover-card-agent-context
                        >{row.context}</span
                      >{#if row.questionMeta}<span
                          class="shrink-0 text-subtle"
                          data-workspace-hover-card-question-meta>{row.questionMeta}</span
                        >{/if}</span
                    ><time
                      class="whitespace-nowrap text-[11px] text-subtle"
                      data-workspace-hover-card-agent-time>{row.updated}</time
                    >
                  </div>{/each}
              </div>
            </section>{/if}{/each}{#if hiddenCount}<div
            class="border-t border-border/50 px-3.5 py-1.5 text-xs font-medium text-subtle"
            data-workspace-hover-card-overflow
          >
            {m.workspace_hoverCard_moreAgents_label({ count: formatInteger(hiddenCount) })}
          </div>{/if}
      </div>{/if}
  {/if}
</section>

<style>
  .workspace-hover-card {
    width: clamp(22rem, 46vw, 40rem);
    max-width: calc(100vw - 1rem);
    container-type: inline-size;
  }
  .agent-row {
    height: 42px;
  }
  @container (max-width:34rem) {
    .task-progress {
      display: none;
    }
    .agent-row {
      grid-template-columns: 1.75rem minmax(3.5rem, 6rem) minmax(0, 1fr) auto;
    }
  }
  @container (max-width:28rem) {
    .updated,
    .agent-row time {
      display: none;
    }
    .agent-row {
      grid-template-columns: 1.75rem minmax(3.5rem, 5.5rem) minmax(0, 1fr);
    }
    .header-meta {
      gap: 0.5rem;
    }
  }
</style>

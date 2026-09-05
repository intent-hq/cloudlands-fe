<script lang="ts">
  import AgentAvatarWithState from '$features/agent/components/agent-avatar/AgentAvatarWithState.svelte';
  import type { AvatarState } from '$features/agent/components/agent-avatar/avatar-state';
  import { activeStreamsTracker } from '$features/agent/services/active-streams-tracker';
  import { derivePendingQuestions } from '$lib/components/chat/questions/pending-questions';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { Button } from '$lib/components/ui/button';
  import type { BuiltinSpecialistId } from '$lib/constants/specialists';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import type { AgentSession, PullRequestInfo, Workspace } from '$shared/types';
  import { getAgentAttentionRequest } from '$shared/utils/agent-attention';
  import { createLogger } from '$lib/utils/client-logger';
  import { navigateToRoute } from '$lib/utils/navigation.client';
  import { onMount } from 'svelte';
  import { writable } from 'svelte/store';
  import Fa from 'svelte-fa';
  import { faChevronRight } from '@fortawesome/free-solid-svg-icons';
  import {
    selectAgentPreview,
    type AgentPreview,
  } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import { ensureWorkspaceTasksLoaded } from '$store/renderer/slices/workspace-tasks/workspace-tasks-slice';
  import { selectAllWorkspaceAgents } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import { ensureAgentSessionLoaded } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import { store as appStore } from '$store/renderer/store';
  import { selectPrMonitors } from '$store/renderer/slices/pr-monitor/pr-monitor-selectors';
  import { selectWorkspaceActivePullRequest } from '$store/renderer/slices/workspace/workspace-selectors';
  import { openAgentTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
  import { openWorkspaceTab } from '$store/renderer/slices/tab-state/tab-state-slice';
  import { selectCurrentWorkspaceTabId } from '$store/renderer/slices/tab-state/tab-state-selectors';
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

  const logger = createLogger('WorkspaceHoverCard');

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
  let repo = $derived(
    workspace?.repositoryName
      ? workspace.repositoryOwner
        ? `${workspace.repositoryOwner} / ${workspace.repositoryName}`
        : workspace.repositoryName
      : m.workspace_hoverCard_localRepository_label(),
  );
  let statusState = $derived(resolveWorkspaceStatusState(workspace ?? {}));
  let status = $derived(getWorkspaceStatusPresentation(statusState));
  let summary = $derived(workspace?.statusMessage?.trim() || '');
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
  let visiblePrRows = $derived(workspacePrRows.slice(0, 3));
  let hiddenPrCount = $derived(Math.max(0, workspacePrRows.length - 3));
  let hasAgentRows = $derived(allRows.length > 0);
  let hasPrRows = $derived(workspacePrRows.length > 0);
  let hasBodyContent = $derived(hasAgentRows || hasPrRows);
  function getWorkspacePrLabel(pr: WorkspacePRPresentationRow): string {
    const identity = pr.repo
      ? m.workspace_card_prBadge_repoLine_tooltip({ repo: pr.repo, number: pr.number })
      : m.workspace_card_prBadge_label({ number: ` #${pr.number}` });
    return [identity, pr.title, pr.details].filter(Boolean).join('\n');
  }
  function openAgentRow(event: MouseEvent, agentId: string) {
    event.stopPropagation();
    if (!workspace || !loadAgentSessions) return;
    const workspaceId = workspace.id;
    if (selectCurrentWorkspaceTabId.select(appStore.state) !== workspaceId) {
      appStore.dispatch(openWorkspaceTab(workspaceId));
      void navigateToRoute(`/workspace/${workspaceId}`).catch((error) => {
        logger.warn('Failed to switch workspace for hover-card agent', { agentId, error });
      });
    }
    appStore.dispatch(openAgentTabRequested(workspaceId, { agentId }));
  }
  function openPullRequestRow(event: MouseEvent, pr: WorkspacePRPresentationRow) {
    event.stopPropagation();
    if (!workspace || !pr.url) return;
    const workspaceId = workspace.id;
    void import('$features/navigation/link-handler').then(({ handleLink }) =>
      handleLink(pr.url, { workspaceId, event }),
    );
  }
</script>

<section
  class="workspace-hover-card shrink-0 overflow-hidden rounded-md bg-background text-left text-foreground shadow-(--elevation-overlay) ring-1 ring-border"
  data-workspace-hover-card
  data-workspace-hover-card-layout="landscape"
>
  {#if isLoading || !workspace}<div>
      <div class="grid gap-0.5 px-5 pt-4">
        <div class="flex min-w-0 items-center justify-between gap-3">
          <Skeleton class="h-7 min-w-0 max-w-64 flex-1" />
          <Skeleton class="h-5 w-20 shrink-0" />
        </div>
        <Skeleton class="h-4 w-40" />
        <Skeleton class="mt-2 h-10 w-full" />
      </div>
      <div class="my-4 border-t border-border" data-workspace-hover-card-divider></div>
      <div
        class="body-grid grid min-w-0 grid-cols-1 items-stretch gap-2 px-5 pb-4"
        data-workspace-hover-card-columns
      >
        <div class="grid" data-workspace-hover-card-activity>
          <Skeleton class="h-10 w-full" />
        </div>
        <div class="pull-requests grid" data-workspace-hover-card-pr-column>
          <Skeleton class="h-10 w-full" />
        </div>
      </div>
    </div>
  {:else}
    <header class="min-w-0 px-5 pt-4" class:pb-4={!hasBodyContent} data-workspace-hover-card-header>
      <div class="min-w-0" data-workspace-hover-card-identity>
        <div class="flex min-w-0 items-center justify-between gap-3">
          <h2
            class="type-body min-w-0 truncate font-medium! text-foreground"
            data-workspace-hover-card-title
          >
            {workspace.title || m.workspace_links_untitled_label()}
          </h2>
          <span
            class="type-caption flex shrink-0 items-center gap-1.5 text-muted-foreground"
            data-workspace-hover-card-status
            ><span class="truncate" data-workspace-hover-card-status-label>{status.label}</span
            ><WorkspaceStatusIcon status={statusState} size={16} decorative /></span
          >
        </div>
        <div
          class="type-caption mt-0.5 min-w-0 truncate text-muted-foreground"
          data-workspace-hover-card-repo
        >
          {repo}
        </div>
        {#if summary}<p
            class="type-caption mt-1 min-w-0 line-clamp-3 text-muted-foreground"
            title={summary}
            data-workspace-hover-card-summary
          >
            {summary}
          </p>{/if}
      </div>
    </header>
    {#if hasBodyContent}<div
        class="my-4 border-t border-border"
        data-workspace-hover-card-divider
      ></div>
      <div
        class="body-grid grid min-w-0 grid-cols-1 items-stretch gap-2 px-5 pb-4"
        data-workspace-hover-card-columns
      >
        {#if hasAgentRows}<section
            class="activity min-w-0"
            aria-label={m.workspace_multiSelectSidebar_agentsTab_label()}
            data-workspace-hover-card-activity
            data-workspace-hover-card-agent-table
          >
            <div class="-mx-2 grid gap-2" role="list">
              {#each visibleRows as row (row.id)}<div role="listitem">
                  <Button
                    variant="plain"
                    class="grid h-auto! min-h-8 w-full min-w-0 cursor-pointer grid-cols-[1.5rem_minmax(0,1fr)_auto] items-start justify-normal gap-x-2.5 gap-y-0 whitespace-normal rounded-sm border-0! px-2! py-0.5! text-left font-normal transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    aria-label={rowAccessibleLabel(row)}
                    data-workspace-hover-card-agent-row
                    data-agent-group-row={row.group}
                    data-attention-kind={row.attentionKind}
                    onclick={(event) => openAgentRow(event, row.id)}
                  >
                    <span
                      class="row-span-2 flex h-8 w-6 items-center justify-start"
                      aria-hidden="true"
                      ><AgentAvatarWithState
                        agentId={row.id}
                        variant="emphasized"
                        state={row.avatarState}
                        specialist={row.specialist ?? null}
                      /></span
                    ><span
                      class="type-body min-w-0 truncate text-foreground"
                      data-workspace-hover-card-agent-name>{row.name}</span
                    ><time
                      class="type-caption whitespace-nowrap text-muted-foreground"
                      datetime={row.updated.dateTime}
                      aria-label={row.updated.accessible}
                      data-workspace-hover-card-agent-time>{row.updated.compact}</time
                    >
                    <span
                      class="agent-detail type-caption flex min-w-0 items-start gap-1.5 text-muted-foreground"
                      title={row.context}
                      data-workspace-hover-card-agent-detail
                      data-workspace-hover-card-agent-preview={row.contextIsPreview || undefined}
                      ><span class="min-w-0 truncate" data-workspace-hover-card-agent-context
                        >{row.context}</span
                      >{#if row.questionMeta}<span
                          class="shrink-0 text-muted-foreground"
                          aria-label={row.questionMeta.accessible}
                          data-workspace-hover-card-question-meta
                          ><span aria-hidden="true">{row.questionMeta.compact}</span></span
                        >{/if}</span
                    >
                  </Button>
                </div>{/each}
            </div>
            {#if hiddenCount}<div
                class="type-body mt-4 flex items-center justify-between text-muted-foreground"
                data-workspace-hover-card-overflow
              >
                <span
                  >{m.workspace_hoverCard_moreAgents_label({
                    count: formatInteger(hiddenCount),
                  })}</span
                >
                <Fa icon={faChevronRight} size={10} />
              </div>{/if}
          </section>{/if}
        {#if hasPrRows}<section
            class="pull-requests min-w-0"
            aria-label={m.workspace_hoverCard_pullRequests_label()}
            data-workspace-hover-card-pr-column
          >
            <div
              class="-mx-2 grid min-w-0 gap-2"
              aria-label={m.workspace_hoverCard_pullRequests_label()}
              role="list"
              data-workspace-hover-card-pr-list
            >
              {#each visiblePrRows as pr (pr.identity)}
                <div role="listitem" aria-label={pr.url ? undefined : getWorkspacePrLabel(pr)}>
                  {#snippet prRowContent()}
                    <Fa
                      icon={pr.statusIcon}
                      size={18}
                      class="shrink-0 justify-self-start {pr.foregroundClass}"
                    />
                    <span
                      class="type-body min-w-0 truncate text-foreground"
                      data-workspace-hover-card-pr-title
                    >
                      {pr.title || m.workspace_hoverCard_pullRequest_label()}
                    </span>
                    <span
                      class="type-caption shrink-0 text-muted-foreground"
                      data-workspace-hover-card-pr-status
                    >
                      {pr.accessibleStateLabel}
                    </span>
                    <span
                      class="type-caption shrink-0 text-muted-foreground"
                      data-workspace-hover-card-pr-number>#{pr.number}</span
                    >
                  {/snippet}
                  {#if pr.url}
                    <Button
                      variant="plain"
                      class="grid h-auto! w-full min-w-0 grid-cols-[1.5rem_minmax(0,1fr)_auto_auto] items-center justify-normal gap-x-2.5 whitespace-normal rounded-sm border-0! px-2! py-1! text-left font-normal transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      aria-label={getWorkspacePrLabel(pr)}
                      data-workspace-hover-card-pr-row
                      data-pr-identity={pr.identity}
                      data-pr-status={pr.status}
                      onclick={(event: MouseEvent) => openPullRequestRow(event, pr)}
                    >
                      {@render prRowContent()}
                    </Button>
                  {:else}
                    <div
                      class="grid w-full min-w-0 grid-cols-[1.5rem_minmax(0,1fr)_auto_auto] items-center gap-x-2.5 rounded-sm px-2 py-1 text-left"
                      data-workspace-hover-card-pr-row
                      data-pr-identity={pr.identity}
                      data-pr-status={pr.status}
                    >
                      {@render prRowContent()}
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
            {#if hiddenPrCount}<div
                class="type-body mt-4 flex items-center justify-between text-muted-foreground"
                data-workspace-hover-card-pr-overflow
              >
                <span
                  >{m.workspace_hoverCard_moreItems_label({
                    count: formatInteger(hiddenPrCount),
                  })}</span
                >
                <Fa icon={faChevronRight} size={10} />
              </div>{/if}
          </section>{/if}
      </div>{/if}
  {/if}
</section>

<style>
  .workspace-hover-card {
    width: 35rem;
    max-width: min(100%, calc(100vw - 3.625rem));
  }
  .agent-detail {
    grid-column: 2 / -1;
  }
</style>

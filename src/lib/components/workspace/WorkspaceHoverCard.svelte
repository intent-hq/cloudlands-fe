<script lang="ts">
  import AgentAvatarWithState from '$features/agent/components/agent-avatar/AgentAvatarWithState.svelte';
  import {
    getAvatarStateForSession,
    type AvatarState,
  } from '$features/agent/components/agent-avatar/avatar-state';
  import { activeStreamsTracker } from '$features/agent/services/active-streams-tracker';
  import { sessionPendingQuestions } from '$lib/components/chat/questions/pending-questions';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import type { BuiltinSpecialistId } from '$lib/constants/specialists';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import type { AgentSession, PullRequestInfo, Workspace } from '$shared/types';
  import { getAgentAttentionRequest } from '$shared/utils/agent-attention';
  import { onMount, tick } from 'svelte';
  import { writable } from 'svelte/store';
  import Fa from 'svelte-fa';
  import { faChevronRight } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
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
  import { selectWorkspacePresencePeople } from '$store/renderer/slices/presence/presence-selectors';
  import type { PresencePerson } from '$store/renderer/slices/presence/presence-types';
  import PresenceAvatarStack from '$features/presence/components/PresenceAvatarStack.svelte';
  import {
    presencePersonLabel,
    presencePersonName,
  } from '$features/presence/components/presence-person';
  import WorkspaceStatusIcon from './WorkspaceStatusIcon.svelte';
  import { constructPrUrl } from './sidebar/sidebar-changes-utils';
  import {
    buildWorkspacePRPresentationModel,
    type WorkspacePRPresentationRow,
  } from './sidebar/workspace-pr-presentation';
  import { formatWorkspaceHoverCardTimestamp } from './workspace-hover-card-time';
  import { shareRosterMemberRemoveRequested } from '$store/renderer/slices/workspace-share/workspace-share-slice';
  import {
    selectWorkspaceRosterCanManage,
    selectWorkspaceRosterRemoveError,
    selectWorkspaceRosterRemovingPrincipalId,
    selectWorkspaceRosterWithheld,
  } from '$store/renderer/slices/workspace-share/workspace-share-selectors';
  import {
    getWorkspaceStatusPresentation,
    resolveWorkspaceStatusState,
  } from './utils/workspace-status-presentation';

  interface Props {
    workspace: Workspace | null;
    isLoading?: boolean;
    activeAgentIds?: string[];
    loadAgentSessions?: boolean;
    loadWorkspaceData?: boolean;
    staticData?: boolean;
  }
  let {
    workspace,
    isLoading = false,
    activeAgentIds = [],
    loadAgentSessions = true,
    loadWorkspaceData = true,
    staticData = false,
  }: Props = $props();
  const workspaceIdStore = writable('');
  function createWorkspaceAgentsStore() {
    return staticData ? writable([]) : selectAllWorkspaceAgents(workspaceIdStore);
  }
  function createPrMonitorsStore() {
    return staticData ? writable([]) : selectPrMonitors(workspaceIdStore);
  }
  function createPresencePeopleStore() {
    return staticData ? writable([]) : selectWorkspacePresencePeople(workspaceIdStore);
  }
  const workspaceAgents$ = createWorkspaceAgentsStore();
  const prMonitors$ = createPrMonitorsStore();
  const presencePeople$ = createPresencePeopleStore();
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
    const canonicalState = getAvatarStateForSession(session);
    const pending = canonicalState === 'question' ? sessionPendingQuestions(session) : null;
    const preview = previewText(selectAgentPreview.select(appStore.state, String(session.id)));
    let group: RowGroup;
    let attentionKind: string | undefined;
    let context: string;
    let avatarState: AvatarState;
    let priority: number;
    let questionMeta: AgentRow['questionMeta'];
    let contextIsPreview = false;
    if (canonicalState === 'question') {
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
          accessible: m.chat_questionWizard_stepCounter_label({ current: 1, total: count }),
        };
      }
    } else if (canonicalState === 'attention-discussion') {
      group = 'attention';
      attentionKind = 'discussion';
      context = attention?.reason?.trim() || m.chat_agentCard_attentionDiscussion_label();
      avatarState = 'attention-discussion';
      priority = 1;
    } else if (canonicalState === 'attention-blocker' || status === 'blocked') {
      group = 'attention';
      attentionKind = 'blocker';
      context = attention?.reason?.trim() || m.chat_agentCard_attentionBlocker_label();
      avatarState = 'attention-blocker';
      priority = 0;
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
    if (staticData) return getWorkspacePullRequest(workspace);
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
  // People roster (multiplayer w5): the rows are the membership-backed presence
  // people of the hovered workspace. Owner controls ride the workspace-share
  // slice keyed by workspace id: Remove is owner-only (`myRole === 'owner'`)
  // and withheld once the daemon refuses an owner-only method; the confirmed
  // removal is dispatched to the share saga, which hands the in-flight
  // principal and any error back through selectors. Only the Remove
  // confirmation step is local. Share… itself lives in the workspace ⋯ menu
  // (WorkspaceProgressCard), not on the card.
  const rosterCanManage$ = staticData
    ? writable(false)
    : selectWorkspaceRosterCanManage(workspaceIdStore);
  const rosterWithheld$ = staticData
    ? writable(false)
    : selectWorkspaceRosterWithheld(workspaceIdStore);
  const removingPrincipalId$ = staticData
    ? writable<string | null>(null)
    : selectWorkspaceRosterRemovingPrincipalId(workspaceIdStore);
  const rosterRemoveError$ = staticData
    ? writable<string | null>(null)
    : selectWorkspaceRosterRemoveError(workspaceIdStore);
  let canManageSharing = $derived($rosterCanManage$);
  let confirmRemovePrincipalId = $state<string | null>(null);
  let peopleEl: HTMLElement | null = $state(null);
  let removingPrincipalId = $derived($removingPrincipalId$);
  let removeError = $derived(
    $rosterWithheld$ ? m.workspace_share_ownerOnly_notice() : $rosterRemoveError$,
  );
  // Swapping Remove for confirm/cancel (and back) unmounts the focused
  // control; move focus onto its replacement so a keyboard user keeps their
  // place and the hover surface does not read the transient blur as leaving.
  async function focusPersonControl(principalId: string, selector: string | null) {
    await tick();
    const row = peopleEl?.querySelector<HTMLElement>(
      `[data-workspace-hover-card-person-row][data-principal-id="${principalId}"]`,
    );
    const control = selector ? row?.querySelector<HTMLElement>(selector) : null;
    if (control) control.focus();
    else peopleEl?.focus();
  }
  function askRemoveMember(principalId: string) {
    confirmRemovePrincipalId = principalId;
    void focusPersonControl(
      principalId,
      '[data-workspace-hover-card-person-remove-confirm] button',
    );
  }
  function cancelRemoveMember(principalId: string) {
    confirmRemovePrincipalId = null;
    void focusPersonControl(principalId, '[data-workspace-hover-card-person-remove]');
  }
  function confirmRemoveMember(principalId: string) {
    if (!workspace || !canManageSharing || removingPrincipalId) return;
    if (confirmRemovePrincipalId !== principalId) return;
    confirmRemovePrincipalId = null;
    appStore.dispatch(
      shareRosterMemberRemoveRequested({ workspaceId: String(workspace.id), principalId }),
    );
    // Remove is disabled while the removal is in flight; park focus on the list.
    void focusPersonControl(principalId, null);
  }
  $effect(() => {
    void workspace?.id;
    confirmRemovePrincipalId = null;
  });
  type PresenceRowState = 'viewing' | 'online' | 'offline';
  const PRESENCE_STATE_RANK: Record<PresenceRowState, number> = {
    viewing: 0,
    online: 1,
    offline: 2,
  };
  function presenceRowState(person: PresencePerson): PresenceRowState {
    return person.viewing ? 'viewing' : person.online ? 'online' : 'offline';
  }
  function presenceStateLabel(state: PresenceRowState): string {
    if (state === 'viewing') return m.workspace_hoverCard_personViewing_label();
    if (state === 'online') return m.workspace_hoverCard_personOnline_label();
    return m.workspace_hoverCard_personOffline_label();
  }
  function presenceRoleLabel(person: PresencePerson): string {
    return person.owner
      ? m.settings_guestSessions_role_owner_label()
      : m.settings_guestSessions_role_collaborator_label();
  }
  /** The login when it is not already the shown name; otherwise nothing. */
  function presenceLogin(person: PresencePerson): string | null {
    const login = person.login?.trim();
    return login && login !== presencePersonName(person) ? login : null;
  }
  function presenceRowLabel(row: PresenceRow): string {
    return [
      presencePersonLabel(row.person),
      presenceLogin(row.person),
      presenceRoleLabel(row.person),
      presenceStateLabel(row.state),
    ]
      .filter(Boolean)
      .join('. ');
  }
  interface PresenceRow {
    person: PresencePerson;
    state: PresenceRowState;
    removable: boolean;
  }
  let presenceRows = $derived(
    $presencePeople$
      .map((person): PresenceRow => ({
        person,
        state: presenceRowState(person),
        removable: canManageSharing && !person.owner && !person.self,
      }))
      .sort((a, b) => PRESENCE_STATE_RANK[a.state] - PRESENCE_STATE_RANK[b.state]),
  );
  let hasAgentRows = $derived(allRows.length > 0);
  let hasPrRows = $derived(workspacePrRows.length > 0);
  let hasPresenceRows = $derived(presenceRows.length > 0);
  let hasBodyContent = $derived(hasAgentRows || hasPrRows || hasPresenceRows);
  function getWorkspacePrLabel(pr: WorkspacePRPresentationRow): string {
    const identity = pr.repo
      ? m.workspace_card_prBadge_repoLine_tooltip({ repo: pr.repo, number: pr.number })
      : m.workspace_card_prBadge_label({ number: ` #${pr.number}` });
    return [identity, pr.title, pr.details].filter(Boolean).join('\n');
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
      <div class="my-3 border-t border-border" data-workspace-hover-card-divider></div>
      <div
        class="body-grid grid min-w-0 grid-cols-1 items-stretch gap-3 px-5 pb-4"
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
            class="type-body min-w-0 truncate font-medium text-foreground"
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
          class="type-caption mt-1 min-w-0 truncate text-muted-foreground"
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
        class="my-3 border-t border-border"
        data-workspace-hover-card-divider
      ></div>
      <div
        class="body-grid grid min-w-0 grid-cols-1 items-stretch gap-3 px-5 pb-4"
        data-workspace-hover-card-columns
      >
        {#if hasAgentRows}<section
            class="activity min-w-0"
            aria-label={m.workspace_multiSelectSidebar_agentsTab_label()}
            data-workspace-hover-card-activity
            data-workspace-hover-card-agent-table
          >
            <div class="grid gap-2" role="list">
              {#each visibleRows as row (row.id)}<div
                  class="agent-row grid min-w-0 grid-cols-[1rem_minmax(0,1fr)_auto] gap-x-2"
                  role="listitem"
                  aria-label={rowAccessibleLabel(row)}
                  data-workspace-hover-card-agent-row
                  data-agent-group-row={row.group}
                  data-attention-kind={row.attentionKind}
                >
                  <span
                    class="row-span-2 flex h-(--text-caption-line-height) items-center"
                    aria-hidden="true"
                    ><AgentAvatarWithState
                      agentId={row.id}
                      variant="compact"
                      state={row.avatarState}
                      specialist={row.specialist ?? null}
                    /></span
                  ><span
                    class="type-caption min-w-0 truncate text-foreground"
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
                </div>{/each}
            </div>
            {#if hiddenCount}<div
                class="type-caption mt-3 flex items-center justify-between text-muted-foreground"
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
              class="grid min-w-0 gap-2"
              aria-label={m.workspace_hoverCard_pullRequests_label()}
              role="list"
              data-workspace-hover-card-pr-list
            >
              {#each visiblePrRows as pr (pr.identity)}
                <div
                  class="grid min-w-0 grid-cols-[1rem_minmax(0,1fr)_auto_auto] items-center gap-x-2"
                  aria-label={getWorkspacePrLabel(pr)}
                  role="listitem"
                  data-workspace-hover-card-pr-row
                  data-pr-identity={pr.identity}
                  data-pr-status={pr.status}
                >
                  <Fa
                    icon={pr.statusIcon}
                    size={16}
                    class="shrink-0 justify-self-start {pr.foregroundClass}"
                  />
                  <span
                    class="type-caption min-w-0 truncate text-foreground"
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
                </div>
              {/each}
            </div>
            {#if hiddenPrCount}<div
                class="type-caption mt-3 flex items-center justify-between text-muted-foreground"
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
        {#if hasPresenceRows}<section
            bind:this={peopleEl}
            class="people min-w-0 outline-none"
            aria-label={m.workspace_hoverCard_people_label()}
            tabindex="-1"
            data-workspace-hover-card-people
          >
            <div
              class="grid max-h-64 min-w-0 gap-3 overflow-y-auto"
              role="list"
              data-workspace-hover-card-people-list
            >
              {#each presenceRows as row (row.person.principalId)}
                {@const login = presenceLogin(row.person)}
                <div
                  class="grid min-w-0 grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-2.5"
                  role="listitem"
                  aria-label={presenceRowLabel(row)}
                  data-workspace-hover-card-person-row
                  data-principal-id={row.person.principalId}
                  data-presence-state={row.state}
                  data-presence-viewing={row.state === 'viewing' || undefined}
                  data-presence-role={row.person.owner ? 'owner' : 'collaborator'}
                  data-presence-self={row.person.self || undefined}
                >
                  <span class="row-span-2 grid place-items-center" aria-hidden="true"
                    ><PresenceAvatarStack people={[row.person]} size={20} decorative /></span
                  ><span
                    class="type-body min-w-0 truncate text-foreground"
                    data-workspace-hover-card-person-name>{presencePersonLabel(row.person)}</span
                  ><span
                    class="type-caption flex shrink-0 items-center gap-1.5 text-muted-foreground"
                    data-workspace-hover-card-person-state
                    ><span
                      class={row.state === 'viewing'
                        ? 'size-1.5 rounded-full bg-success'
                        : row.state === 'online'
                          ? 'size-1.5 rounded-full bg-success/50'
                          : 'size-1.5 rounded-full bg-muted-foreground/40'}
                      aria-hidden="true"
                    ></span>{presenceStateLabel(row.state)}</span
                  >
                  <span
                    class="type-caption flex min-w-0 items-center gap-1.5 text-muted-foreground"
                    data-workspace-hover-card-person-detail
                    >{#if login}<span
                        class="min-w-0 truncate"
                        data-workspace-hover-card-person-login>{login}</span
                      ><span aria-hidden="true">·</span>{/if}<span
                      class="shrink-0"
                      data-workspace-hover-card-person-role>{presenceRoleLabel(row.person)}</span
                    ></span
                  >
                  {#if row.removable}
                    {#if confirmRemovePrincipalId === row.person.principalId}
                      <span
                        class="flex shrink-0 items-center gap-1 justify-self-end"
                        role="group"
                        aria-label={m.workspace_share_removeMember_confirm_label({
                          name: presencePersonName(row.person),
                        })}
                        data-workspace-hover-card-person-remove-confirm
                      >
                        <Button
                          variant="destructive"
                          size="sm"
                          class="h-6 px-2"
                          disabled={removingPrincipalId !== null}
                          onclick={() => confirmRemoveMember(row.person.principalId)}
                          aria-label={m.workspace_share_removeMember_confirmAction_ariaLabel({
                            name: presencePersonName(row.person),
                          })}
                        >
                          {m.settings_guestSessions_remove_label()}
                        </Button>
                        <Button
                          variant="ghost-light"
                          size="sm"
                          class="h-6 px-2"
                          onclick={() => cancelRemoveMember(row.person.principalId)}
                        >
                          {m.workspace_share_cancel_label()}
                        </Button>
                      </span>
                    {:else}
                      <Button
                        variant="ghost"
                        size="sm"
                        class="h-6 justify-self-end px-2"
                        disabled={removingPrincipalId !== null}
                        aria-label={m.workspace_hoverCard_personRemove_ariaLabel({
                          name: presencePersonName(row.person),
                        })}
                        onclick={() => askRemoveMember(row.person.principalId)}
                        data-workspace-hover-card-person-remove={row.person.principalId}
                        >{m.settings_guestSessions_remove_label()}</Button
                      >
                    {/if}
                  {/if}
                </div>
              {/each}
            </div>
            {#if removeError}<p
                class="type-caption mt-2 text-danger"
                role="alert"
                data-workspace-hover-card-people-error
              >
                {removeError}
              </p>{/if}
          </section>{/if}
      </div>{/if}
  {/if}
</section>

<style>
  .workspace-hover-card {
    width: 35rem;
    max-width: min(100%, calc(100vw - 3.625rem));
  }
  .agent-row {
    min-height: 32px;
  }
  .agent-detail {
    grid-column: 2 / -1;
  }
</style>

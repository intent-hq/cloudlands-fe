<script lang="ts">
  import { untrack } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { ListRow } from '$lib/components/patterns/collection';
  import GitHubAvatar from '$lib/components/ui/GitHubAvatar.svelte';
  import RelativeTime from '$lib/components/ui/RelativeTime.svelte';
  import TaskStatusProgress from '$lib/components/workspace/TaskStatusProgress.svelte';
  import { formatCompactNumber, formatInteger } from '$lib/i18n/format';
  import { selectDashboardWorkspaceDetails } from '$store/renderer/slices/hud/hud-selectors';
  import type { HudCardAgent } from '$store/renderer/slices/hud/hud-selectors';
  import { m } from '$shared/paraglide/messages.js';
  import type { Workspace } from '$shared/types';
  import Fa from 'svelte-fa';
  import { faCodeBranch } from '@fortawesome/free-solid-svg-icons';
  import HomeWorkspaceStatus from './HomeWorkspaceStatus.svelte';
  import HomeWorkspacePullBadge from './HomeWorkspacePullBadge.svelte';
  import HomeActivityTime from './HomeActivityTime.svelte';
  import { openHomeWorkspaceFromEvent } from './home-workspace-opening';

  let {
    workspace,
    selected,
    showRepository,
    onselect,
    onopen,
    oncontextmenu,
  }: {
    workspace: Workspace;
    selected: boolean;
    showRepository: boolean;
    onselect: (id: string) => void;
    onopen: (id: string) => void;
    oncontextmenu: (event: MouseEvent | KeyboardEvent, workspace: Workspace) => void;
  } = $props();

  const details$ = selectDashboardWorkspaceDetails(untrack(() => workspace.id));
  const agents = $derived($details$.agents.slice(0, 3));
  const attention = $derived($details$.attentionSnippet);
  const attentionLabel = $derived.by(() => {
    switch (attention?.kind) {
      case 'question':
      case 'pending':
        return m.hud_attention_kindQuestion_label();
      case 'blocker':
        return m.hud_attention_kindBlocked_label();
      case 'discussion':
        return m.hud_attention_kindDiscussion_label();
      case 'failed':
        return m.hud_attention_kindFailed_label();
      default:
        return '';
    }
  });

  function agentLabel(agent: HudCardAgent): string {
    if (agent.isWaitingForAgents) return m.workspace_taskStatus_waiting_label();
    switch (agent.bucket) {
      case 'running':
        return m.hud_agentState_running_label();
      case 'needs-attention':
        return m.hud_agentState_needsAttention_label();
      case 'failed':
        return m.hud_agentState_failed_label();
      case 'done':
        return m.hud_agentState_done_label();
      default:
        return m.hud_agentState_idle_label();
    }
  }
</script>

<Button
  data-home-workspace={workspace.id}
  variant="outline"
  active={selected}
  aria-pressed={selected}
  aria-label={workspace.title}
  wrapContent={false}
  class="h-full min-w-0 w-full flex-col items-stretch justify-start gap-4 whitespace-normal rounded-xl border-border bg-card p-5 text-left font-normal shadow-xs"
  onclick={(event) => {
    if (!openHomeWorkspaceFromEvent(event, workspace.id, onopen)) onselect(workspace.id);
  }}
  onkeydown={(event) => {
    if (!openHomeWorkspaceFromEvent(event, workspace.id, onopen)) oncontextmenu(event, workspace);
  }}
  oncontextmenu={(event) => oncontextmenu(event, workspace)}
>
  <span class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
    <HomeWorkspaceStatus {workspace} showLabel />
    {#if workspace.waiting}
      <span class="type-caption text-muted-foreground" data-home-card-waiting>
        {m.workspace_taskStatus_waiting_label()}
      </span>
    {/if}
    {#if workspace.attention === 'unread'}
      <span class="type-caption text-foreground" data-home-card-unread
        >{m.hud_workspaceState_unread_label()}</span
      >
    {/if}
    <span class="ml-auto shrink-0 type-caption text-muted-foreground"
      ><HomeActivityTime {workspace} /></span
    >
  </span>
  <span class="flex min-w-0 flex-col gap-2">
    <span class="line-clamp-2 type-body font-medium [overflow-wrap:anywhere]"
      >{workspace.title}</span
    >
    {#if workspace.statusMessage}
      <span
        class="home-workspace-summary line-clamp-2 type-caption text-muted-foreground [overflow-wrap:anywhere]"
      >
        {workspace.statusMessage}
      </span>
    {/if}
  </span>
  {#if attention}
    <span class="flex min-w-0 flex-col gap-1 type-caption" data-home-card-attention>
      <span
        class={attention.kind === 'failed'
          ? 'text-danger font-medium'
          : 'text-warning-ink font-medium'}>{attentionLabel}</span
      >
      <span class="line-clamp-3 text-muted-foreground [overflow-wrap:anywhere]">
        {attention.text ||
          (attention.kind === 'failed'
            ? m.hud_card_attnFailedPending_label()
            : m.hud_card_attnPending_label())}
      </span>
    </span>
  {/if}
  {#if agents.length}
    <span class="flex min-w-0 flex-col gap-1" data-home-card-agents>
      {#each agents as agent (agent.id)}
        <ListRow class="min-h-0 px-0 py-1" data-home-card-agent={agent.id}>
          {#snippet leading()}
            <span
              role="img"
              aria-label={agentLabel(agent)}
              class="size-2 rounded-full {agent.bucket === 'failed'
                ? 'bg-danger'
                : agent.bucket === 'needs-attention'
                  ? 'bg-warning'
                  : agent.bucket === 'running'
                    ? 'bg-success'
                    : 'bg-muted-foreground'}"
            ></span>
          {/snippet}
          {#snippet title()}
            {#if agent.treePrefix}<span class="mr-1 text-muted-foreground" aria-hidden="true"
                >{agent.treePrefix}</span
              >{/if}
            {agent.name}
          {/snippet}
          {#snippet description()}
            {#if agent.line && agent.line !== attention?.text}<span
                class="line-clamp-1 [overflow-wrap:anywhere]">{agent.line}</span
              >{/if}
          {/snippet}
          {#snippet trailing()}
            {#if agent.lastActivityTs && agent.bucket !== 'idle'}
              <span class="text-muted-foreground"
                ><RelativeTime date={agent.lastActivityTs} compact /></span
              >
            {/if}
          {/snippet}
        </ListRow>
      {/each}
      {#if $details$.agents.length > agents.length}
        <span class="type-caption text-muted-foreground"
          >{m.workspace_hoverCard_moreAgents_label({
            count: formatInteger($details$.agents.length - agents.length),
          })}</span
        >
      {/if}
    </span>
  {/if}
  <span class="mt-auto flex min-w-0 flex-col gap-4">
    {#if workspace.taskStats && workspace.taskStats.total > 0}
      <span class="flex min-w-0 flex-col gap-2">
        <span class="type-caption text-muted-foreground"
          >{m.workspace_flameGraph_tasksComplete_label({
            completed: formatInteger(workspace.taskStats.completed),
            total: formatInteger(workspace.taskStats.total),
          })}</span
        >
        <TaskStatusProgress
          fallback={workspace.taskStats}
          progress={workspace.taskStats.completed / workspace.taskStats.total}
          ariaLabel={m.workspace_hoverCard_taskProgress_ariaLabel()}
          size="compact"
          motion={false}
        />
      </span>
    {/if}
    <span class="flex min-w-0 flex-col gap-2 type-caption text-muted-foreground">
      {#if showRepository && workspace.repositoryName}
        <span class="flex min-w-0 items-center gap-1.5">
          {#if workspace.repositoryOwner}<GitHubAvatar
              identity={workspace.repositoryOwner}
              class="shrink-0 rounded-sm"
            />{/if}
          <span class="truncate"
            >{[workspace.repositoryOwner, workspace.repositoryName].filter(Boolean).join('/')}</span
          >
        </span>
      {/if}
      {#if workspace.branch}
        <span class="flex min-w-0 items-center gap-1.5"
          ><Fa icon={faCodeBranch} class="shrink-0" /><span class="truncate"
            >{workspace.branch}</span
          ></span
        >
      {/if}
      {#if workspace.pullRequests?.length || workspace.activePullRequest || $details$.tokens !== null}<span
          class="flex min-w-0 flex-wrap items-center justify-between gap-2"
        >
          {#if workspace.pullRequests?.length || workspace.activePullRequest}<span class="min-w-0"
              ><HomeWorkspacePullBadge {workspace} /></span
            >{/if}
          {#if $details$.tokens !== null}
            <span class="ml-auto tabular-nums" data-home-card-tokens
              >{m.workspace_tokenUsage_tokenValue_label({
                tokens: formatCompactNumber($details$.tokens),
              })}</span
            >
          {/if}
        </span>{/if}
    </span>
  </span>
</Button>

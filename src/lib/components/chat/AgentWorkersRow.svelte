<script lang="ts">
  import { writable } from 'svelte/store';
  import Fa from 'svelte-fa';
  import { faTerminal, faChevronDown } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import * as Menu from '$lib/components/ui/menu';
  import KebabIcon from '$lib/components/icons/KebabIcon.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import { formatRelativeTime } from '$lib/i18n/format';
  import { store } from '$store/renderer/store';
  import {
    selectAgentWorkerRows,
    selectAgentWorkers,
  } from '$store/renderer/slices/agent-workers/agent-workers-selectors';
  import {
    agentWorkerStopRequested,
    agentWorkersRetryRequested,
  } from '$store/renderer/slices/agent-workers/agent-workers-slice';
  import type { WorkerObservation } from '$features/agent-workers/types';
  import {
    safeSubscriptionSlide,
    SUBSCRIPTION_ROW_GEOMETRY_CLASS,
    SUBSCRIPTION_ROW_TYPOGRAPHY_CLASS,
    SUBSCRIPTION_LEADING_COLUMN_CLASS,
    SUBSCRIPTION_ICON_CLASS,
    SUBSCRIPTION_ICON_BUTTON_CLASS,
    SUBSCRIPTION_CHEVRON_CLASS,
    SUBSCRIPTION_CHEVRON_SIZE_CLASS,
    SUBSCRIPTION_INSET_ROW_DIVIDER_CLASS,
    SUBSCRIPTION_WAKE_BODY_PADDING_CLASS,
  } from './subscription-disclosure';
  import { CHAT_OPERATIONAL_ICON_CLASS } from './operational-disclosure-row';

  let {
    workspaceId,
    agentId,
    showLoadFailure = false,
  }: { workspaceId: string; agentId: string; showLoadFailure?: boolean } = $props();
  const workspaceIdStore = writable('');
  const agentIdStore = writable('');
  $effect(() => {
    workspaceIdStore.set(workspaceId);
    agentIdStore.set(agentId);
  });
  const entry$ = selectAgentWorkers(workspaceIdStore, agentIdStore);
  const rows$ = selectAgentWorkerRows(workspaceIdStore, agentIdStore);
  let expanded = $state<string | null>(null);
  const label = (row: WorkerObservation) =>
    row.name?.trim() || row.taskType?.trim() || m.chat_agentWorkers_unnamed_label();
  /** Daemon-clock age (asOf - firstObservedAt) anchored to arrival time, so skew cancels. */
  const startedAt = (row: WorkerObservation) => {
    const { snapshot, receivedAt } = $entry$;
    return snapshot && receivedAt !== undefined
      ? receivedAt - Math.max(0, snapshot.asOf - row.firstObservedAt)
      : row.firstObservedAt;
  };
  function toggleDetails(id: string) {
    expanded = expanded === id ? null : id;
  }
</script>

{#if showLoadFailure && $entry$.status === 'failed'}
  <!-- A failed read must not look like "no background tasks". -->
  <div
    class="flex min-w-0 items-center gap-2 {SUBSCRIPTION_ROW_GEOMETRY_CLASS} {SUBSCRIPTION_ROW_TYPOGRAPHY_CLASS}"
    role="alert"
    data-testid="agent-workers-load-failed"
  >
    <span class={SUBSCRIPTION_LEADING_COLUMN_CLASS} aria-hidden="true"
      ><Fa
        icon={faTerminal}
        size={16}
        class="{CHAT_OPERATIONAL_ICON_CLASS} {SUBSCRIPTION_ICON_CLASS}"
      /></span
    >
    <span class="min-w-0 flex-1 truncate text-muted-foreground"
      >{m.chat_agentWorkers_loadFailed_error()}</span
    >
    <Button
      variant="ghost"
      size="sm"
      class="shrink-0"
      onclick={() => store.dispatch(agentWorkersRetryRequested(workspaceId, agentId))}
      >{m.chat_agentWorkers_retry_label()}</Button
    >
  </div>
{/if}

{#if $entry$.status === 'ready' && $entry$.snapshot?.truncated}
  <p
    class="type-caption text-muted-foreground {SUBSCRIPTION_WAKE_BODY_PADDING_CLASS}"
    data-testid="agent-workers-incomplete"
  >
    {m.chat_agentWorkers_incomplete_description()}
  </p>
{/if}

{#each $rows$ as row (row.identity.asyncTaskId)}
  {@const id = row.identity.asyncTaskId}
  {@const name = label(row)}
  {@const operation = $entry$.operations[id]}
  {@const stoppable = row.status === 'running' && row.canStop}
  {@const detailsId = `agent-worker-details-${id}`}
  <div
    class="min-w-0 overflow-hidden {SUBSCRIPTION_INSET_ROW_DIVIDER_CLASS}"
    data-testid="agent-worker-row"
  >
    <div
      class="flex min-w-0 items-center {SUBSCRIPTION_ROW_GEOMETRY_CLASS} {SUBSCRIPTION_ROW_TYPOGRAPHY_CLASS}"
    >
      <span class={SUBSCRIPTION_LEADING_COLUMN_CLASS} aria-hidden="true"
        ><Fa
          icon={faTerminal}
          size={16}
          class="{CHAT_OPERATIONAL_ICON_CLASS} {SUBSCRIPTION_ICON_CLASS}"
        /></span
      >
      <Button
        variant="plain"
        class="min-w-0 flex-1 justify-start truncate p-0 text-left {SUBSCRIPTION_ROW_TYPOGRAPHY_CLASS}"
        aria-expanded={expanded === id}
        aria-controls={detailsId}
        onclick={() => toggleDetails(id)}
      >
        <span class="truncate">{name}</span>
      </Button>
      <span class="shrink-0 text-muted-foreground" data-testid="agent-worker-state"
        >{operation?.pending
          ? m.chat_agentWorkers_stopping_label()
          : row.status === 'unknown'
            ? m.chat_agentWorkers_unknown_label()
            : m.chat_agentWorkers_running_label()}</span
      >
      {#if stoppable}
        <Menu.Root>
          <Menu.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                variant="plain"
                size="icon-compact"
                class="h-6 w-6 shrink-0 {SUBSCRIPTION_ICON_BUTTON_CLASS}"
                aria-label={m.chat_agentWorkers_actions_ariaLabel({ name })}
                disabled={operation?.pending}><KebabIcon class="h-3 w-3" /></Button
              >
            {/snippet}
          </Menu.Trigger>
          <Menu.Content align="end" side="top" aria-label={name}>
            <Menu.Item
              onSelect={() => store.dispatch(agentWorkerStopRequested(workspaceId, agentId, id))}
              >{m.chat_agentWorkers_stop_label()}</Menu.Item
            >
          </Menu.Content>
        </Menu.Root>
      {/if}
      <Button
        variant="plain"
        size="icon-compact"
        class="h-6 w-6 shrink-0 {SUBSCRIPTION_ICON_BUTTON_CLASS}"
        aria-label={name}
        aria-expanded={expanded === id}
        aria-controls={detailsId}
        onclick={() => toggleDetails(id)}
      >
        <Fa
          icon={faChevronDown}
          size={16}
          class="{SUBSCRIPTION_CHEVRON_SIZE_CLASS} {SUBSCRIPTION_CHEVRON_CLASS} {expanded === id
            ? ''
            : 'rotate-90'}"
        />
      </Button>
    </div>
    {#if operation?.error}<p
        role="alert"
        class="type-caption text-danger {SUBSCRIPTION_WAKE_BODY_PADDING_CLASS}"
      >
        {operation.message}
      </p>{/if}
    {#if expanded === id}
      <div
        id={detailsId}
        class="grid min-w-0 gap-1 text-xs text-muted-foreground {SUBSCRIPTION_WAKE_BODY_PADDING_CLASS}"
        transition:safeSubscriptionSlide
      >
        {#if row.taskType}<span>{m.chat_agentWorkers_type_description({ type: row.taskType })}</span
          >{/if}
        <span
          >{m.chat_agentWorkers_started_description({
            time: formatRelativeTime(startedAt(row)),
          })}</span
        >
        {#if row.status === 'unknown'}<span>{m.chat_agentWorkers_unknown_description()}</span>{/if}
      </div>
    {/if}
  </div>
{/each}

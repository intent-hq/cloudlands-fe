<script lang="ts">
  /**
   * FallbackPlanCard (monorepo#3249)
   *
   * Compact live task list for providers that emit no native ACP `plan`
   * session update. Reads the canonical workspace-task store (fed by
   * `task.list` + the existing `task:status-changed` debounced refetch path)
   * — zero new polling or RPC. Source priority: a native ACP plan for this
   * session (the `nativePlans` slice) always wins and hides this card.
   * Delegated task agents see only their linked task(s); root/Coordinator
   * agents see the spec-linked list in source order, cancelled excluded.
   */
  import { writable } from 'svelte/store';
  import Fa from 'svelte-fa';
  import { faChevronDown, faListCheck } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import type { TaskStatus } from '$shared/types';
  import TaskStatusIcon from '$lib/components/tiptap/TaskStatusIcon.svelte';
  import { Button } from '$lib/components/ui/button';
  import {
    SUBSCRIPTION_CHEVRON_CLASS,
    SUBSCRIPTION_CHEVRON_SIZE_CLASS,
    SUBSCRIPTION_DISCLOSURE_ROW_CLASS,
    SUBSCRIPTION_ICON_BUTTON_CLASS,
    SUBSCRIPTION_ICON_CLASS,
    SUBSCRIPTION_LEADING_COLUMN_CLASS,
    SUBSCRIPTION_LEADING_CONTENT_CLASS,
    safeSubscriptionSlide,
  } from './subscription-disclosure';
  import { selectFallbackPlanTasksForAgent } from '$store/renderer/slices/workspace-tasks/workspace-tasks-selectors';
  import { selectHasNativePlanForAgent } from '$store/renderer/slices/native-plans/native-plans-selectors';
  import { ensureWorkspaceTasksLoaded } from '$store/renderer/slices/workspace-tasks/workspace-tasks-slice';
  import { store as appStore } from '$store/renderer/store';

  interface Props {
    workspaceId: string;
    agentId: string;
    compact?: boolean;
    visible?: boolean;
  }

  let { workspaceId, agentId, compact = false, visible = $bindable(false) }: Props = $props();

  // Mirror props into stores so the selector readables track prop changes.
  // svelte-ignore state_referenced_locally -- the effects below mirror later prop changes.
  const workspaceIdStore = writable(workspaceId);
  // svelte-ignore state_referenced_locally -- the effects below mirror later prop changes.
  const agentIdStore = writable(agentId);
  $effect(() => {
    workspaceIdStore.set(workspaceId);
  });
  $effect(() => {
    agentIdStore.set(agentId);
  });

  // Rehydrate on mount/workspace switch (idempotent; no-op once initialized —
  // 'task:status-changed' + the debounced refetch keep loaded state fresh).
  $effect(() => {
    if (workspaceId) appStore.dispatch(ensureWorkspaceTasksLoaded(workspaceId));
  });

  const tasks$ = selectFallbackPlanTasksForAgent(workspaceIdStore, agentIdStore);
  const hasNativePlan$ = selectHasNativePlanForAgent(agentIdStore);

  const shown = $derived(!$hasNativePlan$ && $tasks$.length > 0);
  const componentId = $props.id();
  const bodyId = `fallback-plan-body-${componentId}`;
  let isCollapsed = $state(false);

  const heading = $derived(
    $tasks$.length === 1
      ? m.chat_fallbackPlan_heading_one({ count: formatInteger($tasks$.length) })
      : m.chat_fallbackPlan_heading_many({ count: formatInteger($tasks$.length) }),
  );

  const statusLabels: Record<TaskStatus, () => string> = {
    not_started: m.workspace_taskStatus_notStarted_label,
    waiting: m.workspace_taskStatus_waiting_label,
    discussion_needed: m.workspace_taskStatus_discussionNeeded_label,
    blocked: m.workspace_taskStatus_blocked_label,
    in_progress: m.workspace_taskStatus_inProgress_label,
    review_required: m.workspace_taskStatus_reviewRequired_label,
    complete: m.workspace_taskStatus_complete_label,
    cancelled: m.workspace_taskStatus_cancelled_label,
  };

  function statusLabel(status: TaskStatus): string {
    return statusLabels[status]?.() ?? status;
  }

  $effect(() => {
    visible = shown;
  });
</script>

{#if shown}
  <div
    class="w-full min-w-0 max-w-full {compact ? 'mt-6' : 'mt-8'}"
    data-testid="fallback-plan-utility-area"
  >
    <section
      class="w-full min-w-0 max-w-full overflow-hidden rounded-lg border border-border bg-card/80 shadow-sm font-family-child"
      data-conversation-layer="fallback-plan"
      data-testid="fallback-plan-card"
      aria-label={m.chat_fallbackPlan_card_ariaLabel()}
    >
      <h2 data-testid="fallback-plan-outer-header">
        <Button
          variant="plain"
          type="button"
          class="shrink whitespace-normal rounded-none border-0 text-left {SUBSCRIPTION_DISCLOSURE_ROW_CLASS} {SUBSCRIPTION_ICON_BUTTON_CLASS} focus-visible:ring-2 focus-visible:ring-inset"
          data-testid="fallback-plan-summary"
          aria-expanded={!isCollapsed}
          aria-controls={bodyId}
          onclick={() => (isCollapsed = !isCollapsed)}
        >
          <span class="w-max shrink-0 {SUBSCRIPTION_LEADING_CONTENT_CLASS}">
            <span class={SUBSCRIPTION_LEADING_COLUMN_CLASS} aria-hidden="true">
              <Fa icon={faListCheck} size={14} class="h-3.5! w-3.5! shrink-0 {SUBSCRIPTION_ICON_CLASS}" />
            </span>
            <span
              class="whitespace-nowrap text-muted-foreground"
              data-testid="fallback-plan-summary-title"
            >
              {heading}
            </span>
          </span>
          <span class="min-w-0 flex-1" aria-hidden="true"></span>
          <span class="inline-flex h-6 w-6 shrink-0 items-center justify-center">
            <Fa
              icon={faChevronDown}
              size={16}
              class="{SUBSCRIPTION_CHEVRON_SIZE_CLASS} {SUBSCRIPTION_CHEVRON_CLASS} {isCollapsed
                ? 'rotate-90'
                : ''}"
            />
          </span>
        </Button>
      </h2>
      {#if !isCollapsed}
        <ul
          id={bodyId}
          class="m-0 list-none border-t border-border p-0"
          data-testid="fallback-plan-body"
          transition:safeSubscriptionSlide
        >
          {#each $tasks$ as task (task.id)}
            <li
              class="flex min-h-9 w-full min-w-0 max-w-full items-center gap-2 overflow-hidden px-3 py-2"
              data-testid="fallback-plan-task"
              data-task-status={task.status}
              aria-label={m.chat_fallbackPlan_taskStatus_ariaLabel({
                title: task.title,
                status: statusLabel(task.status),
              })}
            >
              <TaskStatusIcon status={task.status} size={14} />
              <span
                class="type-body min-w-0 truncate font-normal {task.status === 'complete'
                  ? 'text-ghost line-through'
                  : 'text-muted-foreground'}"
              >
                {task.title}
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>
{/if}

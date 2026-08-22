<script lang="ts">
  import Fa from 'svelte-fa';
  import {
    faCheck,
    faCircle,
    faCircleQuestion,
    faClock,
    faEye,
    faListCheck,
    faSpinner,
    faTriangleExclamation,
  } from '@fortawesome/free-solid-svg-icons';
  import { formatInteger } from '$lib/i18n/format';
  import type { TaskStatus, WorkspaceTask } from '$shared/types';
  import { m } from '$shared/paraglide/messages.js';
  import {
    CHAT_OPERATIONAL_ICON_CLASS,
    CHAT_OPERATIONAL_LEADING_CLASS,
    OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS,
  } from './operational-disclosure-row';

  let { tasks, compact = false }: { tasks: WorkspaceTask[]; compact?: boolean } = $props();

  const completedCount = $derived(tasks.filter((task) => task.status === 'complete').length);

  function statusLabel(status: TaskStatus): string {
    if (status === 'not_started') return m.workspace_taskStatus_notStarted_label();
    if (status === 'waiting') return m.workspace_taskStatus_waiting_label();
    if (status === 'discussion_needed') return m.workspace_taskStatus_discussionNeeded_label();
    if (status === 'blocked') return m.workspace_taskStatus_blocked_label();
    if (status === 'in_progress') return m.workspace_taskStatus_inProgress_label();
    if (status === 'review_required') return m.workspace_taskStatus_reviewRequired_label();
    if (status === 'complete') return m.workspace_taskStatus_complete_label();
    return m.workspace_taskStatus_cancelled_label();
  }

  function statusIcon(status: TaskStatus) {
    if (status === 'complete') return faCheck;
    if (status === 'in_progress') return faSpinner;
    if (status === 'waiting') return faClock;
    if (status === 'discussion_needed') return faCircleQuestion;
    if (status === 'blocked') return faTriangleExclamation;
    if (status === 'review_required') return faEye;
    return faCircle;
  }
</script>

{#if tasks.length > 0}
  <section
    class="w-full min-w-0 max-w-full overflow-hidden rounded-lg border border-border bg-card/80 shadow-sm font-family-child {compact
      ? 'mt-6'
      : 'mt-8'}"
    aria-label={m.chat_workspaceTasks_title()}
    data-testid="workspace-task-fallback-card"
  >
    <div
      class="{OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS} grid min-h-8 min-w-0 grid-cols-[var(--operational-leading-slot-size)_minmax(0,1fr)_auto] items-center gap-[var(--operational-leading-gap)] bg-muted/30 px-[var(--operational-row-inline-padding)] py-1.5"
    >
      <span class={CHAT_OPERATIONAL_LEADING_CLASS} aria-hidden="true">
        <Fa icon={faListCheck} size={16} class={CHAT_OPERATIONAL_ICON_CLASS} />
      </span>
      <h2 class="min-w-0 truncate type-body font-medium text-foreground">
        {m.chat_workspaceTasks_title()}
      </h2>
      <span
        class="shrink-0 whitespace-nowrap type-caption text-muted-foreground"
        aria-live="polite"
      >
        {m.chat_workspaceTasks_progress_label({
          completed: formatInteger(completedCount),
          total: formatInteger(tasks.length),
        })}
      </span>
    </div>

    <ul class="min-w-0 border-t border-border py-1" data-testid="workspace-task-fallback-entries">
      {#each tasks as task (task.id)}
        {@const label = statusLabel(task.status)}
        <li
          class="{OPERATIONAL_ROW_GEOMETRY_TOKENS_CLASS} grid min-h-9 min-w-0 max-w-full grid-cols-[var(--operational-leading-slot-size)_minmax(0,1fr)] items-start gap-[var(--operational-leading-gap)] px-[var(--operational-row-inline-padding)] py-1.5 type-body {task.status ===
          'in_progress'
            ? 'bg-muted/30'
            : ''}"
          data-task-status={task.status}
          aria-current={task.status === 'in_progress' ? 'step' : undefined}
        >
          <span class="{CHAT_OPERATIONAL_LEADING_CLASS} mt-0.5" aria-hidden="true">
            <Fa
              icon={statusIcon(task.status)}
              size={task.status === 'not_started' ? 7 : 14}
              class="{task.status === 'not_started'
                ? 'h-2! w-2! shrink-0 opacity-50'
                : CHAT_OPERATIONAL_ICON_CLASS} {task.status === 'in_progress'
                ? 'animate-spin motion-reduce:animate-none'
                : ''}"
            />
          </span>
          <span class="min-w-0">
            <span
              class="block min-w-0 whitespace-normal break-words text-foreground"
              class:font-medium={task.status === 'in_progress'}
              class:line-through={task.status === 'complete'}
              class:opacity-65={task.status === 'complete'}>{task.title}</span
            >
            <span class="block type-caption text-muted-foreground">{label}</span>
          </span>
        </li>
      {/each}
    </ul>
  </section>
{/if}

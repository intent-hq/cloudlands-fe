<script lang="ts">
  import { Popover } from 'bits-ui';
  import Fa from 'svelte-fa';
  import {
    faCheck,
    faCircle,
    faCircleQuestion,
    faClock,
    faEye,
    faSpinner,
    faTriangleExclamation,
  } from '@fortawesome/free-solid-svg-icons';
  import ShimmerOverlay from '$lib/components/ui/ShimmerOverlay.svelte';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import type { TaskProgressItem, TaskProgressStatus } from './workspace-task-fallback';
  import { taskProgressFlip, taskProgressRowTransition } from './task-progress-motion';

  let { tasks }: { tasks: TaskProgressItem[] } = $props();
  let open = $state(false);
  let triggerElement: HTMLButtonElement | null = $state(null);
  let collisionBoundary: Element[] = $state([]);
  const activeTasks = $derived(tasks.filter((task) => task.status !== 'completed'));
  const completedTasks = $derived(tasks.filter((task) => task.status === 'completed'));
  const stackedActiveTasks = $derived([
    ...activeTasks.filter((task) => task.status !== 'running'),
    ...activeTasks.filter((task) => task.status === 'running'),
  ]);
  const orderedTasks = $derived([...activeTasks, ...completedTasks]);
  const progressLabel = $derived(
    m.chat_taskProgress_progress_ariaLabel({
      completed: formatInteger(completedTasks.length),
      total: formatInteger(tasks.length),
    }),
  );

  function statusLabel(status: TaskProgressStatus): string {
    if (status === 'completed') return m.workspace_taskStatus_complete_label();
    if (status === 'running') return m.workspace_taskStatus_inProgress_label();
    if (status === 'waiting') return m.workspace_taskStatus_waiting_label();
    if (status === 'discussion_needed') return m.workspace_taskStatus_discussionNeeded_label();
    if (status === 'blocked') return m.workspace_taskStatus_blocked_label();
    if (status === 'review_required') return m.workspace_taskStatus_reviewRequired_label();
    return m.workspace_taskStatus_notStarted_label();
  }

  function statusIcon(status: TaskProgressStatus) {
    if (status === 'completed') return faCheck;
    if (status === 'running') return faSpinner;
    if (status === 'waiting') return faClock;
    if (status === 'discussion_needed') return faCircleQuestion;
    if (status === 'blocked') return faTriangleExclamation;
    if (status === 'review_required') return faEye;
    return faCircle;
  }

  function statusIndicatorClass(status: TaskProgressStatus): string {
    if (status === 'completed') return 'bg-primary text-primary-foreground';
    if (status === 'running') return 'bg-primary/20 text-primary';
    if (status === 'discussion_needed') return 'bg-primary/15 text-primary/90';
    if (status === 'blocked') return 'bg-primary/25 text-primary';
    if (status === 'review_required') return 'bg-primary/10 text-primary/80';
    if (status === 'waiting') return 'bg-muted text-muted-foreground/80';
    return 'bg-muted text-muted-foreground/50';
  }

  function handleOpenChange(nextOpen: boolean) {
    open = nextOpen;
    if (!nextOpen) return;
    const panel = triggerElement?.closest('[data-panel-id]');
    collisionBoundary = panel ? [panel] : [];
  }

  function handleTriggerFocus() {
    open = true;
  }
</script>

{#snippet statusIndicator(status: TaskProgressStatus, testId: string, completedCount?: number)}
  <span
    class="inline-flex size-3.5 shrink-0 items-center justify-center rounded-full leading-none {statusIndicatorClass(
      status,
    )}"
    aria-hidden="true"
    data-testid={testId}
    data-task-status={status}
    data-completed-count={completedCount}
  >
    <Fa
      icon={statusIcon(status)}
      size={status === 'pending' ? 6 : 8}
      class="{status === 'pending' ? 'size-1.5!' : 'size-2!'} {status === 'running'
        ? 'motion-safe:animate-spin motion-reduce:animate-none'
        : ''}"
    />
  </span>
{/snippet}

{#snippet taskRowContent(task: TaskProgressItem)}
  {@render statusIndicator(task.status, 'task-progress-row-status-icon')}
  <span
    class="min-w-0 truncate {task.status === 'completed'
      ? 'text-muted-foreground line-through decoration-muted-foreground/30'
      : 'text-popover-foreground'}"
    title={task.title}
  >
    {#if task.status === 'running'}
      <ShimmerOverlay duration={3} class="block min-w-0 truncate">{task.title}</ShimmerOverlay>
    {:else}
      {task.title}
    {/if}
  </span>
{/snippet}

{#if tasks.length > 0}
  <Popover.Root bind:open onOpenChange={handleOpenChange}>
    <Popover.Trigger openOnHover openDelay={120} closeDelay={180}>
      {#snippet child({ props })}
        <button
          {...props}
          bind:this={triggerElement}
          type="button"
          class="relative m-0 inline-flex h-7 w-fit shrink-0 items-center justify-center gap-0 rounded-md border border-transparent bg-transparent p-0 text-muted-foreground outline-none transition-[border-color,box-shadow] duration-[var(--motion-fast)] focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 motion-reduce:transition-none"
          aria-label={progressLabel}
          aria-expanded={open}
          onfocus={handleTriggerFocus}
          data-testid="task-progress-trigger"
        >
          <span
            class="isolate flex items-center"
            aria-hidden="true"
            data-testid="task-progress-icon-stack"
          >
            {#if completedTasks.length > 0}
              <span
                class="relative z-0 inline-flex shrink-0"
                data-testid="task-progress-stack-item"
              >
                {@render statusIndicator(
                  'completed',
                  'task-progress-status-icon',
                  completedTasks.length,
                )}
              </span>
            {/if}
            {#each stackedActiveTasks as task, index (task.id)}
              <span
                class="relative inline-flex shrink-0 {completedTasks.length > 0 || index > 0
                  ? '-ml-1.75'
                  : ''}"
                style:z-index={index + 1}
                data-testid="task-progress-stack-item"
              >
                {@render statusIndicator(task.status, 'task-progress-status-icon')}
              </span>
            {/each}
          </span>
        </button>
      {/snippet}
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content
        role="dialog"
        aria-label={m.chat_taskProgress_list_ariaLabel()}
        align="end"
        side="bottom"
        sideOffset={4}
        {collisionBoundary}
        collisionPadding={8}
        trapFocus={false}
        onOpenAutoFocus={(event) => event.preventDefault()}
        class="type-body z-(--layer-popover) w-72 max-w-[min(calc(100vw-var(--space-4)),calc(var(--bits-popover-content-available-width)-var(--space-2)))] overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-(--elevation-overlay) outline-none"
        data-testid="task-progress-popover"
      >
        <div class="min-w-0" aria-live="polite">
          <ul class="min-w-0" data-testid="task-progress-list">
            {#each orderedTasks as task (task.id)}
              <li
                class="flex h-7 min-w-0 items-center gap-2 overflow-hidden rounded-md px-2 text-popover-foreground transition-[color,opacity] duration-[var(--motion-fast)] motion-reduce:transition-none"
                class:opacity-70={task.status === 'completed'}
                data-testid="task-progress-row"
                data-task-id={task.id}
                data-task-status={task.status}
                aria-label={m.chat_taskProgress_task_ariaLabel({
                  status: statusLabel(task.status),
                  title: task.title,
                })}
                animate:taskProgressFlip
                transition:taskProgressRowTransition
              >
                {@render taskRowContent(task)}
              </li>
            {/each}
          </ul>
        </div>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
{/if}

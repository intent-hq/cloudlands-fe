<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Popover } from 'bits-ui';
  import Fa from 'svelte-fa';
  import {
    faCheck,
    faCircle,
    faCircleQuestion,
    faClock,
    faEllipsis,
    faEye,
    faListCheck,
    faSpinner,
    faTriangleExclamation,
  } from '@fortawesome/free-solid-svg-icons';
  import ShimmerOverlay from '$lib/components/ui/ShimmerOverlay.svelte';
  import { DROPDOWN_SURFACE_CLASS } from '$lib/components/ui/dropdown-surface';
  import { TooltipShortcut } from '$lib/components/ui/tooltip';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import type { TaskProgressItem, TaskProgressStatus } from './workspace-task-fallback';
  import { taskProgressFlip, taskProgressRowTransition } from './task-progress-motion';

  interface Props {
    tasks: TaskProgressItem[];
    presentation?: 'status-stack' | 'checklist';
  }

  let { tasks, presentation = 'status-stack' }: Props = $props();
  let open = $state(false);
  let triggerElement: HTMLButtonElement | null = $state(null);
  let contentElement: HTMLElement | null = $state(null);
  let collisionBoundary: Element[] = $state([]);
  let preserveOutsideFocusOnClose = $state(false);
  let announcement = $state('');
  let announcementTimer: ReturnType<typeof setTimeout> | undefined;
  let previousTaskStates: Map<string, string> | undefined;
  const MAX_STACK_SLOTS = 5;
  const ANNOUNCEMENT_DELAY_MS = 120;
  const activeTasks = $derived(tasks.filter((task) => task.status !== 'completed'));
  const completedTasks = $derived(tasks.filter((task) => task.status === 'completed'));
  const runningTasks = $derived(activeTasks.filter((task) => task.status === 'running'));
  const otherActiveTasks = $derived(activeTasks.filter((task) => task.status !== 'running'));
  const completedStackSlots = $derived(completedTasks.length > 0 ? 1 : 0);
  const unboundedStackSlots = $derived(activeTasks.length + completedStackSlots);
  const hasStackOverflow = $derived(unboundedStackSlots > MAX_STACK_SLOTS);
  const activeStackCapacity = $derived(
    MAX_STACK_SLOTS - completedStackSlots - (hasStackOverflow ? 1 : 0),
  );
  const visibleRunningTasks = $derived(runningTasks.slice(0, activeStackCapacity));
  const visibleOtherActiveTasks = $derived(
    otherActiveTasks.slice(0, Math.max(0, activeStackCapacity - visibleRunningTasks.length)),
  );
  const stackedActiveTasks = $derived([...visibleOtherActiveTasks, ...visibleRunningTasks]);
  const overflowCount = $derived(
    Math.max(0, unboundedStackSlots - completedStackSlots - stackedActiveTasks.length),
  );
  const orderedTasks = $derived([...activeTasks, ...completedTasks]);
  const progressLabel = $derived(
    m.chat_taskProgress_progress_ariaLabel({
      completed: formatInteger(completedTasks.length),
      total: formatInteger(tasks.length),
    }),
  );

  $effect(() => {
    const nextTaskStates = new Map(
      tasks.map((task) => [task.id, `${task.status}\u0000${task.title}`]),
    );
    if (!previousTaskStates) {
      previousTaskStates = nextTaskStates;
      return;
    }

    const changedTask = tasks.find(
      (task) => previousTaskStates?.get(task.id) !== nextTaskStates.get(task.id),
    );
    previousTaskStates = nextTaskStates;
    if (!changedTask) return;

    clearTimeout(announcementTimer);
    announcement = '';
    announcementTimer = setTimeout(() => {
      announcement = m.chat_taskProgress_task_ariaLabel({
        status: statusLabel(changedTask.status),
        title: changedTask.title,
      });
    }, ANNOUNCEMENT_DELAY_MS);
  });

  onDestroy(() => {
    clearTimeout(announcementTimer);
  });

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

  function handleOpenChange(nextOpen: boolean) {
    open = nextOpen;
    if (!nextOpen) return;
    const panel = triggerElement?.closest('[data-panel-id]');
    collisionBoundary = panel ? [panel] : [];
  }

  function handleTriggerKeydown(event: KeyboardEvent) {
    if (event.key === 'Tab' && open) {
      preserveOutsideFocusOnClose = true;
      handleOpenChange(false);
      return;
    }
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    handleOpenChange(!open);
  }

  function handleFocusOutside(event: FocusEvent) {
    if (!open || !(event.target instanceof Node)) return;
    if (triggerElement?.contains(event.target) || contentElement?.contains(event.target)) return;
    preserveOutsideFocusOnClose = true;
    handleOpenChange(false);
  }

  function handleCloseAutoFocus(event: Event) {
    if (!preserveOutsideFocusOnClose) return;
    event.preventDefault();
    preserveOutsideFocusOnClose = false;
  }
</script>

{#snippet statusIndicator(
  status: TaskProgressStatus,
  testId: string,
  completedCount?: number,
  className = '',
)}
  <span
    class="inline-flex size-3.5 shrink-0 items-center justify-center rounded-full bg-background text-foreground leading-none {className}"
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
  {@render statusIndicator(task.status, 'task-progress-row-status-icon', undefined, 'mt-0.5')}
  <span
    class="line-clamp-2 min-w-0 flex-1 {task.status === 'completed'
      ? 'text-muted-foreground'
      : 'text-popover-foreground'}"
    dir="auto"
    title={task.title}
  >
    {#if task.status === 'running'}
      <ShimmerOverlay duration={3} class="line-clamp-2 min-w-0">{task.title}</ShimmerOverlay>
    {:else}
      {task.title}
    {/if}
  </span>
{/snippet}

{#if tasks.length > 0}
  <Popover.Root bind:open onOpenChange={handleOpenChange}>
    <TooltipShortcut label={progressLabel} side="bottom" delayDuration={300} disabled={open}>
      <Popover.Trigger
        bind:ref={triggerElement}
        type="button"
        class="relative m-0 inline-flex h-(--row-action-target-compact) min-w-(--row-action-target-compact) w-fit shrink-0 items-center justify-center gap-0 rounded-md border border-transparent bg-background p-0 text-muted-foreground outline-none transition-[border-color,box-shadow,opacity,scale] duration-(--motion-fast) motion-safe:active:scale-[0.97] focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring motion-reduce:scale-100 motion-reduce:transition-none"
        aria-label={progressLabel}
        aria-expanded={open}
        onkeydown={handleTriggerKeydown}
        data-row-task-action
        data-testid="task-progress-trigger"
      >
        {#if presentation === 'checklist'}
          <span
            class="inline-flex size-3.5 items-center justify-center"
            aria-hidden="true"
            data-testid="task-progress-checklist-icon"
          >
            <Fa icon={faListCheck} size={14} class="size-3.5!" />
          </span>
        {:else}
          <span
            class="isolate flex items-center"
            aria-hidden="true"
            data-testid="task-progress-icon-stack"
          >
            {#if completedTasks.length > 0}
              <span
                class="relative z-0 inline-flex shrink-0"
                data-testid="task-progress-stack-item"
                data-task-status="completed"
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
                style:z-index={task.status === 'running' ? MAX_STACK_SLOTS + 1 : index + 1}
                data-testid="task-progress-stack-item"
                data-task-id={task.id}
              >
                {@render statusIndicator(task.status, 'task-progress-status-icon')}
              </span>
            {/each}
            {#if hasStackOverflow}
              <span
                class="relative -ml-1.75 inline-flex shrink-0"
                style:z-index={MAX_STACK_SLOTS}
                data-testid="task-progress-stack-item"
                data-task-status="overflow"
              >
                <span
                  class="inline-flex size-3.5 shrink-0 items-center justify-center rounded-full bg-background text-foreground leading-none"
                  aria-hidden="true"
                  data-testid="task-progress-overflow-indicator"
                  data-overflow-count={overflowCount}
                >
                  <Fa icon={faEllipsis} size={8} class="size-2!" />
                </span>
              </span>
            {/if}
          </span>
        {/if}
      </Popover.Trigger>
    </TooltipShortcut>
    <span
      class="sr-only"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="task-progress-announcement">{announcement}</span
    >
    <Popover.Portal>
      <Popover.Content
        bind:ref={contentElement}
        role="dialog"
        aria-label={m.chat_taskProgress_list_ariaLabel()}
        align="end"
        side="bottom"
        sideOffset={4}
        {collisionBoundary}
        collisionPadding={8}
        trapFocus={false}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={handleCloseAutoFocus}
        onFocusOutside={handleFocusOutside}
        class="{DROPDOWN_SURFACE_CLASS} type-caption w-72"
        data-testid="task-progress-popover"
      >
        <div
          class="min-h-0 min-w-0 max-h-64 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain"
          data-testid="task-progress-scroll-region"
        >
          <ul class="min-w-0" data-testid="task-progress-list">
            {#each orderedTasks as task (task.id)}
              <li
                class="flex min-h-7 min-w-0 items-start gap-2 overflow-hidden rounded-md px-2 py-1 text-popover-foreground transition-colors duration-(--motion-fast) motion-reduce:transition-none"
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

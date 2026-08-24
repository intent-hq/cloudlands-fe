<script lang="ts">
  import { tick } from 'svelte';
  import { Popover } from 'bits-ui';
  import Fa from 'svelte-fa';
  import {
    faCheck,
    faChevronRight,
    faCircle,
    faCircleQuestion,
    faClock,
    faEye,
    faSpinner,
    faTriangleExclamation,
  } from '@fortawesome/free-solid-svg-icons';
  import Button from '$lib/components/ui/button/button.svelte';
  import ShimmerOverlay from '$lib/components/ui/ShimmerOverlay.svelte';
  import { formatInteger } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import type { TaskProgressItem, TaskProgressStatus } from './workspace-task-fallback';
  import { taskProgressFlip, taskProgressRowTransition } from './task-progress-motion';

  let { tasks }: { tasks: TaskProgressItem[] } = $props();
  let open = $state(false);
  let completedOpen = $state(false);
  let triggerElement: HTMLButtonElement | null = $state(null);
  let completedToggle: HTMLButtonElement | null = $state(null);
  let collisionBoundary: Element[] = $state([]);
  const controlId = $props.id();
  const completedContentId = `task-progress-completed-${controlId}`;
  const activeTasks = $derived(tasks.filter((task) => task.status !== 'completed'));
  const completedTasks = $derived(tasks.filter((task) => task.status === 'completed'));
  const completedLabel = $derived(
    completedTasks.length === 1
      ? m.chat_taskProgress_completed_one()
      : m.chat_taskProgress_completed_many({ count: formatInteger(completedTasks.length) }),
  );
  const progressLabel = $derived(
    m.chat_taskProgress_progress_ariaLabel({
      completed: formatInteger(completedTasks.length),
      total: formatInteger(tasks.length),
    }),
  );

  $effect.pre(() => {
    if (completedTasks.length === 0 && document.activeElement === completedToggle) {
      triggerElement?.focus({ preventScroll: true });
    }
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

  function triggerStatusClass(status: TaskProgressStatus): string {
    if (status === 'completed') return 'text-emerald-600 dark:text-emerald-400';
    if (status === 'running') return 'text-sky-500';
    if (status === 'waiting') return 'text-muted-foreground';
    if (status === 'discussion_needed') return 'text-amber-500';
    if (status === 'blocked') return 'text-destructive';
    if (status === 'review_required') return 'text-blue-500';
    return 'text-muted-foreground/60';
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

  async function handleTriggerKeydown(event: KeyboardEvent) {
    if (event.key !== 'ArrowDown' || completedTasks.length === 0) return;
    event.preventDefault();
    open = true;
    await tick();
    completedToggle?.focus({ preventScroll: true });
  }
</script>

{#snippet taskRowContent(task: TaskProgressItem)}
  <span class="inline-flex size-4 items-center justify-center" aria-hidden="true">
    <Fa
      icon={statusIcon(task.status)}
      size={task.status === 'pending' ? 7 : 13}
      class="{task.status === 'pending'
        ? 'size-2! opacity-50'
        : 'size-3.5! opacity-70'} {task.status === 'running' ? 'motion-safe:animate-pulse' : ''}"
    />
  </span>
  <span
    class="min-w-0 truncate"
    class:line-through={task.status === 'completed'}
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
        <Button
          {...props}
          bind:ref={triggerElement}
          variant="ghost-light"
          size="xs"
          class="h-6 min-w-0 px-1! focus-visible:border-border focus-visible:bg-muted focus-visible:ring-0"
          aria-label={progressLabel}
          aria-expanded={open}
          onfocus={handleTriggerFocus}
          onkeydown={handleTriggerKeydown}
          data-testid="task-progress-trigger"
        >
          <span class="flex items-center" aria-hidden="true" data-testid="task-progress-icon-stack">
            {#each activeTasks as task, index (task.id)}
              <span
                class="relative inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-background shadow-sm {triggerStatusClass(
                  task.status,
                )} {index > 0 ? '-ml-1.5' : ''}"
                data-testid="task-progress-status-icon"
                data-task-status={task.status}
              >
                <Fa
                  icon={statusIcon(task.status)}
                  size={task.status === 'pending' ? 6 : 10}
                  class="{task.status === 'pending' ? 'size-1.5!' : 'size-2.5!'} {task.status ===
                  'running'
                    ? 'motion-safe:animate-spin motion-reduce:animate-none'
                    : ''}"
                />
              </span>
            {/each}
            {#if completedTasks.length > 0}
              <span
                class="relative inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-background shadow-sm {triggerStatusClass(
                  'completed',
                )} {activeTasks.length > 0 ? '-ml-1.5' : ''}"
                data-testid="task-progress-status-icon"
                data-task-status="completed"
                data-completed-count={completedTasks.length}
              >
                <Fa icon={faCheck} size={10} class="size-2.5!" />
              </span>
            {/if}
          </span>
        </Button>
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
        class="z-(--layer-popover) w-80 max-w-[min(calc(100vw-var(--space-4)),calc(var(--bits-popover-content-available-width)-var(--space-2)))] overflow-hidden rounded-(--radius-medium) border border-border bg-popover p-1 text-popover-foreground shadow-(--elevation-overlay) outline-none"
        data-testid="task-progress-popover"
      >
        <div class="min-w-0" aria-live="polite">
          {#if activeTasks.length > 0}
            <ul class="min-w-0" data-testid="task-progress-active-list">
              {#each activeTasks as task (task.id)}
                <li
                  class="grid h-8 min-w-0 grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 overflow-hidden rounded-md px-2 text-muted-foreground transition-[color,opacity] duration-[var(--motion-fast)] motion-reduce:transition-none"
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
          {/if}
          {#if completedTasks.length > 0}
            <div class="min-w-0">
              <button
                bind:this={completedToggle}
                type="button"
                class="flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left type-caption text-muted-foreground outline-none transition-colors hover:bg-accent/60 hover:text-accent-foreground focus-visible:bg-accent/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40 motion-reduce:transition-none"
                aria-expanded={completedOpen}
                aria-controls={completedContentId}
                onclick={() => (completedOpen = !completedOpen)}
                data-testid="task-progress-completed-toggle"
              >
                <Fa
                  icon={faChevronRight}
                  size={10}
                  class="size-3! shrink-0 transition-transform duration-[var(--motion-fast)] motion-reduce:transition-none {completedOpen
                    ? 'rotate-90'
                    : ''}"
                />
                <span class="min-w-0 truncate">{completedLabel}</span>
              </button>
              {#if completedOpen}
                <ul
                  id={completedContentId}
                  class="min-w-0"
                  data-testid="task-progress-completed-list"
                  transition:taskProgressRowTransition
                >
                  {#each completedTasks as task (task.id)}
                    <li
                      class="grid h-8 min-w-0 grid-cols-[1rem_minmax(0,1fr)] items-center gap-2 overflow-hidden rounded-md px-2 text-muted-foreground opacity-65 transition-[color,opacity] duration-[var(--motion-fast)] motion-reduce:transition-none"
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
              {/if}
            </div>
          {/if}
        </div>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
{/if}

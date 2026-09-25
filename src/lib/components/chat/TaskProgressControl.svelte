<script lang="ts">
  import { onDestroy } from 'svelte';
  import { on } from 'svelte/events';
  import { Popover } from 'bits-ui';
  import Fa from 'svelte-fa';
  import {
    faCheck,
    faCircle,
    faCircleQuestion,
    faClock,
    faEllipsis,
    faEye,
    faTriangleExclamation,
  } from '@fortawesome/free-solid-svg-icons';
  import ListChecksIcon from 'phosphor-svelte/lib/ListChecksIcon';
  import XIcon from 'phosphor-svelte/lib/XIcon';
  import { CHAT_ICON_SIZE } from './chat-icon-size';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Select } from '$lib/components/ui/select';
  import { EmptyState } from '$lib/components/patterns/screen';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
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
  let query = $state('');
  let statusFilter = $state<TaskProgressStatus | 'all'>('all');
  let statusFilterOpen = $state(false);
  const statusMenuId = $props.id();
  let keepFiltersVisible = $state(false);
  let searchElement: HTMLInputElement | null = $state(null);
  let triggerElement: HTMLButtonElement | null = $state(null);
  let contentElement: HTMLElement | null = $state(null);
  let scrollRegionElement: HTMLDivElement | null = $state(null);
  let pendingEntryFocus = $state<'search' | 'list' | null>(null);
  let collisionBoundary: Element[] = $state([]);
  let preserveOutsideFocusOnClose = $state(false);
  let suppressTooltipAfterOutsideDismissal = $state(false);
  let pointerTooltipResetArmed = false;
  let keyboardTooltipResetArmed = false;
  let outsideDismissalPointerId: number | null = null;
  let announcement = $state('');
  let announcementTimer: ReturnType<typeof setTimeout> | undefined;
  let previousTaskStates: Map<string, string> | undefined;
  const MAX_STACK_SLOTS = 5;
  const ANNOUNCEMENT_DELAY_MS = 120;
  const FILTER_THRESHOLD = 8;
  const filterStatuses: TaskProgressStatus[] = [
    'pending',
    'running',
    'waiting',
    'discussion_needed',
    'blocked',
    'review_required',
    'completed',
  ];
  const showFilters = $derived(tasks.length >= FILTER_THRESHOLD || keepFiltersVisible);
  const statusCounts = $derived(
    filterStatuses.map((status) => ({
      status,
      count: tasks.filter((task) => task.status === status).length,
    })),
  );
  const filterOptions = $derived([
    { value: 'all', label: m.chat_taskProgress_all_label(), count: tasks.length },
    ...statusCounts
      .filter(({ status, count }) => count > 0 || statusFilter === status)
      .map(({ status, count }) => ({ value: status, label: statusLabel(status), count })),
  ]);
  const selectedFilter = $derived(filterOptions.find((option) => option.value === statusFilter));
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
  const normalizedQuery = $derived(query.trim().toLowerCase());
  const filteredTasks = $derived(
    orderedTasks.filter(
      (task) =>
        (statusFilter === 'all' || task.status === statusFilter) &&
        task.title.toLowerCase().includes(normalizedQuery),
    ),
  );
  const progressLabel = $derived(
    m.chat_taskProgress_progress_ariaLabel({
      completed: formatInteger(completedTasks.length),
      total: formatInteger(tasks.length),
    }),
  );

  $effect(() => {
    if (!open) {
      query = '';
      statusFilter = 'all';
      statusFilterOpen = false;
      keepFiltersVisible = false;
    } else if (tasks.length >= FILTER_THRESHOLD) {
      // Keep controls mounted through live shrink, even while their input has focus.
      keepFiltersVisible = true;
    }
  });

  $effect(() => {
    if (tasks.length === 0) {
      open = false;
      pendingEntryFocus = null;
      resetTooltipSuppression();
    }
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

  $effect(() => {
    const ownerWindow = triggerElement?.ownerDocument.defaultView;
    if (!ownerWindow) return;
    const removePointerDown = on(ownerWindow, 'pointerdown', handleWindowPointerDown, {
      capture: true,
    });
    const removePointerCancel = on(ownerWindow, 'pointercancel', handleWindowPointerCancel, {
      capture: true,
    });
    const removeFocusIn = on(ownerWindow, 'focusin', handleFocusOutside, { capture: true });
    return () => {
      removePointerDown();
      removePointerCancel();
      removeFocusIn();
    };
  });

  onDestroy(() => {
    clearTimeout(announcementTimer);
    pendingEntryFocus = null;
  });

  $effect(() => {
    if (!open) pendingEntryFocus = null;
    focusPendingEntry();
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
    if (status === 'waiting') return faClock;
    if (status === 'discussion_needed') return faCircleQuestion;
    if (status === 'blocked') return faTriangleExclamation;
    if (status === 'review_required') return faEye;
    return faCircle;
  }

  function handleOpenChange(nextOpen: boolean) {
    open = nextOpen;
    if (!nextOpen) {
      pendingEntryFocus = null;
      outsideDismissalPointerId = null;
      return;
    }
    resetTooltipSuppression();
    const panel = triggerElement?.closest('[data-panel-id]');
    collisionBoundary = panel ? [panel] : [];
  }

  function resetFilters() {
    statusFilter = 'all';
    clearSearch();
  }

  function clearSearch() {
    query = '';
    searchElement?.focus({ preventScroll: true });
  }

  function handleSearchKeydown(event: KeyboardEvent) {
    if (event.key !== 'ArrowDown' && event.key !== 'PageDown') return;
    event.preventDefault();
    pendingEntryFocus = 'list';
    focusPendingEntry();
  }

  function isInsideControl(target: Node) {
    return (
      triggerElement?.contains(target) ||
      contentElement?.contains(target) ||
      contentElement?.ownerDocument.getElementById(statusMenuId)?.contains(target)
    );
  }

  function handleWindowPointerDown(event: PointerEvent) {
    if (!open || event.button !== 0 || !(event.target instanceof Node)) return;
    if (isInsideControl(event.target)) return;
    outsideDismissalPointerId = event.pointerId;
    suppressTooltipForOutsideDismissal();
  }

  function handleWindowPointerCancel(event: PointerEvent) {
    if (outsideDismissalPointerId !== event.pointerId) return;
    resetTooltipSuppression();
  }

  function suppressTooltipForOutsideDismissal() {
    suppressTooltipAfterOutsideDismissal = true;
    pointerTooltipResetArmed = false;
    keyboardTooltipResetArmed = false;
  }

  function resetTooltipSuppression() {
    suppressTooltipAfterOutsideDismissal = false;
    pointerTooltipResetArmed = false;
    keyboardTooltipResetArmed = false;
    outsideDismissalPointerId = null;
  }

  function handleTriggerPointerEnter(event: PointerEvent) {
    if (event.pointerType === 'touch' || open || !suppressTooltipAfterOutsideDismissal) return;
    pointerTooltipResetArmed = true;
  }

  function handleTriggerPointerLeave(event: PointerEvent) {
    if (
      event.pointerType === 'touch' ||
      open ||
      !suppressTooltipAfterOutsideDismissal ||
      !pointerTooltipResetArmed
    )
      return;
    resetTooltipSuppression();
  }

  function handleTriggerBlur() {
    if (!open && suppressTooltipAfterOutsideDismissal) keyboardTooltipResetArmed = true;
  }

  function handleTriggerFocus() {
    if (open || !suppressTooltipAfterOutsideDismissal || !keyboardTooltipResetArmed) return;
    resetTooltipSuppression();
  }

  function handleTriggerKeydown(event: KeyboardEvent) {
    if (event.key === 'Tab' && open) {
      preserveOutsideFocusOnClose = true;
      handleOpenChange(false);
      return;
    }
    if ((event.key === 'ArrowDown' || event.key === 'PageDown') && open) {
      event.preventDefault();
      pendingEntryFocus = event.key === 'ArrowDown' && showFilters ? 'search' : 'list';
      focusPendingEntry();
      return;
    }
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    handleOpenChange(!open);
  }

  function handleFocusOutside(event: FocusEvent) {
    if (!open || !(event.target instanceof Node)) return;
    if (isInsideControl(event.target)) return;
    if (suppressTooltipAfterOutsideDismissal) keyboardTooltipResetArmed = true;
    preserveOutsideFocusOnClose = true;
    handleOpenChange(false);
  }

  function focusPendingEntry() {
    if (!open || !pendingEntryFocus) return;
    const target = pendingEntryFocus === 'search' ? searchElement : scrollRegionElement;
    if (!target) return;
    target.focus({ preventScroll: true });
    // Keep the intent until the portalled region can actually receive focus.
    if (target.ownerDocument.activeElement === target) {
      pendingEntryFocus = null;
    }
  }

  function handleOpenAutoFocus(event: Event) {
    event.preventDefault();
    focusPendingEntry();
  }

  function handleCloseAutoFocus(event: Event) {
    event.preventDefault();
    // A focus-scope remount is not a dismissal and must not consume pending entry.
    if (open) return;
    pendingEntryFocus = null;
    // Remounting replaces the primitive's pre-focus memory; restore explicitly.
    if (!preserveOutsideFocusOnClose) triggerElement?.focus({ preventScroll: true });
    preserveOutsideFocusOnClose = false;
  }
</script>

{#snippet statusIndicator(
  status: TaskProgressStatus,
  testId: string,
  completedCount?: number,
  className = '',
  expanded = false,
)}
  <span
    class="inline-flex size-3.5 shrink-0 items-center justify-center rounded-full bg-background text-foreground leading-none {className}"
    aria-hidden="true"
    data-testid={testId}
    data-task-status={status}
    data-completed-count={completedCount}
  >
    {#if status === 'running'}
      <IntentMarkLoader
        size={expanded ? 14 : 8}
        class={expanded ? 'size-(--row-icon-size-regular)!' : 'size-2!'}
      />
    {:else}
      <Fa
        icon={statusIcon(status)}
        size={expanded ? 14 : status === 'pending' ? 6 : 8}
        class={expanded
          ? 'size-(--row-icon-size-regular)!'
          : status === 'pending'
            ? 'size-1.5!'
            : 'size-2!'}
      />
    {/if}
  </span>
{/snippet}

{#snippet taskRowContent(task: TaskProgressItem)}
  {@render statusIndicator(task.status, 'task-progress-row-status-icon', undefined, 'mt-0.5', true)}
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
    <TooltipShortcut
      label={progressLabel}
      side="bottom"
      delayDuration={300}
      disabled={open || suppressTooltipAfterOutsideDismissal}
    >
      <Popover.Trigger bind:ref={triggerElement}>
        {#snippet child({ props })}
          <Button
            {...props}
            variant="ghost-light"
            size="icon-sm"
            active={open}
            class="transition-[color,opacity,scale] motion-safe:active:scale-[0.97] motion-reduce:scale-100 {presentation ===
            'status-stack'
              ? 'min-w-(--control-height-small) w-fit'
              : ''}"
            aria-label={progressLabel}
            aria-expanded={open}
            onkeydown={handleTriggerKeydown}
            onpointerenter={handleTriggerPointerEnter}
            onpointerleave={handleTriggerPointerLeave}
            onblur={handleTriggerBlur}
            onfocus={handleTriggerFocus}
            data-row-task-action
            data-testid="task-progress-trigger"
          >
            {#if presentation === 'checklist'}
              <span
                class="inline-flex size-4 items-center justify-center"
                aria-hidden="true"
                data-testid="task-progress-checklist-icon"
              >
                <ListChecksIcon size={CHAT_ICON_SIZE.compact} weight="regular" class="size-4!" />
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
          </Button>
        {/snippet}
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
        onOpenAutoFocus={handleOpenAutoFocus}
        onCloseAutoFocus={handleCloseAutoFocus}
        onFocusOutside={handleFocusOutside}
        class="{DROPDOWN_SURFACE_CLASS} type-caption w-72"
        data-testid="task-progress-popover"
      >
        <div class="shrink-0 px-2 py-1.5 text-muted-foreground" data-testid="task-progress-summary">
          {m.chat_taskProgress_summary_label({
            completed: formatInteger(completedTasks.length),
            total: formatInteger(tasks.length),
          })}
        </div>
        {#if showFilters}
          <div class="flex min-w-0 shrink-0 flex-col gap-1 px-1 pb-2">
            <div class="relative min-w-0">
              <Input
                bind:ref={searchElement}
                bind:value={query}
                type="search"
                size="compact"
                class="pr-8 [&::-webkit-search-cancel-button]:hidden"
                placeholder={m.chat_taskProgress_search_placeholder()}
                aria-label={m.chat_taskProgress_search_placeholder()}
                onkeydown={handleSearchKeydown}
              />
              {#if query}
                <Button
                  variant="ghost-light"
                  size="icon-compact"
                  class="absolute right-0.5 top-1/2 -translate-y-1/2"
                  aria-label={m.chat_taskProgress_clearSearch_ariaLabel()}
                  onclick={clearSearch}
                >
                  <XIcon aria-hidden="true" />
                </Button>
              {/if}
            </div>
            <Select.Root
              value={statusFilter}
              bind:open={statusFilterOpen}
              items={filterOptions}
              onchange={(value) => (statusFilter = value as TaskProgressStatus | 'all')}
            >
              <Select.Trigger
                aria-label={m.chat_taskProgress_filters_ariaLabel()}
                class="h-(--control-height-small) px-2"
              >
                <span class="min-w-0 flex-1 truncate text-left">{selectedFilter?.label}</span>
                <span class="tabular-nums text-muted-foreground">
                  {formatInteger(selectedFilter?.count ?? 0)}
                </span>
              </Select.Trigger>
              <Select.Content portal wrapperId={statusMenuId}>
                {#each filterOptions as option (option.value)}
                  <Select.Item value={option.value} label={option.label}>
                    <span class="flex min-w-0 items-center gap-2">
                      <span class="min-w-0 flex-1 truncate">{option.label}</span>
                      <span class="tabular-nums text-muted-foreground">
                        {formatInteger(option.count)}
                      </span>
                    </span>
                  </Select.Item>
                {/each}
              </Select.Content>
            </Select.Root>
          </div>
        {/if}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -- keyboard-scrollable region, see WAI-ARIA APG scrollable-region-focusable pattern -->
        <div
          bind:this={scrollRegionElement}
          tabindex={0}
          aria-label={m.chat_taskProgress_list_ariaLabel()}
          class="min-h-0 min-w-0 max-h-64 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="task-progress-scroll-region"
        >
          <ul class="min-w-0" data-testid="task-progress-list">
            {#each filteredTasks as task (task.id)}
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
          {#if filteredTasks.length === 0}
            <EmptyState density="compact" data-testid="task-progress-no-matches">
              {#snippet title()}{m.chat_taskProgress_noMatches_label()}{/snippet}
              {#snippet actions()}
                <Button variant="ghost" size="compact" onclick={resetFilters}>
                  {m.chat_taskProgress_reset_label()}
                </Button>
              {/snippet}
            </EmptyState>
          {/if}
        </div>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
{/if}

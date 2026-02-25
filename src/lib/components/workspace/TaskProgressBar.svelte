<script lang="ts">
  import { cn } from '$lib/utils';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import TaskStatusIcon from '$lib/components/tiptap/TaskStatusIcon.svelte';
  import AugieAvatarWithState from '$lib/components/ui/auggie-avatar/AugieAvatarWithState.svelte';
  import type { AvatarState } from '$lib/components/ui/auggie-avatar/avatar-state';
  import type { TaskStatus } from '$shared/types';
  import type { BuiltinSpecialistId } from '$lib/constants/specialists';

  export interface TaskDetail {
    id?: string;
    title: string;
    status: TaskStatus;
    agentName?: string;
    agentId?: string;
    agentState?: AvatarState;
    agentSpecialist?: BuiltinSpecialistId | null;
  }

  interface Props {
    stats: { total: number; completed: number; inProgress: number; notStarted: number };
    tasks?: TaskDetail[];
    /** Max number of bars to render */
    maxBars?: number;
    /** Bar dimensions */
    barWidth?: string;
    barHeight?: string;
    /** Gap between bars */
    gap?: string;
    class?: string;
  }

  let {
    stats,
    tasks = [],
    maxBars = 20,
    barWidth = '1px',
    barHeight = '16px',
    gap = '1px',
    class: className,
  }: Props = $props();

  const barColor: Record<string, string> = {
    completed: '#22c55e',
    inProgress: '#4F7BF7',
    notStarted: 'var(--border)',
  };

  let taskBars = $derived.by(() => {
    const { completed, inProgress, notStarted, total } = stats;
    if (total === 0) return [];
    // Build full bar array in order: completed, inProgress, notStarted
    const allBars = [
      ...Array(completed).fill('completed'),
      ...Array(inProgress).fill('inProgress'),
      ...Array(Math.max(0, notStarted)).fill('notStarted'),
    ];
    // If fits, show all; otherwise show the LAST maxBars (tail) to mimic flamegraph
    if (allBars.length <= maxBars) return allBars;
    return allBars.slice(allBars.length - maxBars);
  });

  // Group tasks by status for tooltip
  let completedTasks = $derived(tasks.filter((t) => t.status === 'complete'));
  let inProgressTasks = $derived(
    tasks.filter((t) => t.status === 'in_progress' || t.status === 'review_required'),
  );
  let pendingTasks = $derived(
    tasks.filter(
      (t) =>
        t.status !== 'complete' &&
        t.status !== 'in_progress' &&
        t.status !== 'review_required' &&
        t.status !== 'cancelled',
    ),
  );
  let cancelledTasks = $derived(tasks.filter((t) => t.status === 'cancelled'));

  let hasTasks = $derived(tasks.length > 0);
</script>

{#if stats.total > 0}
  <Tooltip
    side="top"
    align="start"
    sideOffset={6}
    contentClass="max-w-xs p-0"
    delayDuration={200}
    disableHoverableContent={false}
  >
    {#snippet content()}
      <div class="flex flex-col py-2 px-3 gap-2 max-h-80 overflow-y-auto">
        <!-- Header -->
        <div class="flex items-center justify-between gap-3">
          <span class="text-xs font-semibold text-foreground">
            {stats.completed}/{stats.total} tasks
          </span>
          <div class="flex items-center gap-3 text-[10px] text-muted-foreground">
            {#if stats.completed > 0}
              <span class="flex items-center gap-1">
                <span class="size-1.5 rounded-full" style:background-color="#22c55e"></span>
                {stats.completed}
              </span>
            {/if}
            {#if stats.inProgress > 0}
              <span class="flex items-center gap-1">
                <span class="size-1.5 rounded-full" style:background-color="#4F7BF7"></span>
                {stats.inProgress}
              </span>
            {/if}
            {#if stats.notStarted > 0}
              <span class="flex items-center gap-1">
                <span class="size-1.5 rounded-full bg-border"></span>
                {stats.notStarted}
              </span>
            {/if}
          </div>
        </div>

        <!-- Task list -->
        {#if hasTasks}
          <!-- In progress tasks first -->
          {#each inProgressTasks as task}
            <div class="flex items-start gap-2">
              <div class="shrink-0 mt-0.5">
                <TaskStatusIcon status={task.status} size={14} />
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-xs leading-snug truncate">{task.title}</div>
                {#if task.agentId}
                  <div class="flex items-center gap-1 mt-0.5">
                    <AugieAvatarWithState
                      agentId={task.agentId}
                      state={task.agentState || 'idle'}
                      size={12}
                      specialist={task.agentSpecialist}
                    />
                    {#if task.agentName}
                      <span class="text-[10px] text-muted-foreground truncate"
                        >{task.agentName}</span
                      >
                    {/if}
                  </div>
                {/if}
              </div>
            </div>
          {/each}

          <!-- Pending tasks -->
          {#each pendingTasks as task}
            <div class="flex items-start gap-2">
              <div class="shrink-0 mt-0.5">
                <TaskStatusIcon status={task.status} size={14} />
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-xs leading-snug truncate">{task.title}</div>
                {#if task.agentId}
                  <div class="flex items-center gap-1 mt-0.5">
                    <AugieAvatarWithState
                      agentId={task.agentId}
                      state={task.agentState || 'idle'}
                      size={12}
                      specialist={task.agentSpecialist}
                    />
                    {#if task.agentName}
                      <span class="text-[10px] text-muted-foreground truncate"
                        >{task.agentName}</span
                      >
                    {/if}
                  </div>
                {/if}
              </div>
            </div>
          {/each}

          <!-- Completed tasks (collapsed summary) -->
          {#if completedTasks.length > 0}
            <div class="flex flex-col gap-0.5 pt-1 border-t border-border/40">
              {#each completedTasks.slice(0, 3) as task}
                <div class="flex items-center gap-2">
                  <div class="shrink-0">
                    <TaskStatusIcon status="complete" size={12} />
                  </div>
                  <span class="text-[11px] text-muted-foreground/50 truncate line-through"
                    >{task.title}</span
                  >
                </div>
              {/each}
              {#if completedTasks.length > 3}
                <span class="text-[10px] text-muted-foreground/40 pl-4"
                  >+{completedTasks.length - 3} more completed</span
                >
              {/if}
            </div>
          {/if}

          <!-- Cancelled tasks -->
          {#if cancelledTasks.length > 0}
            <div class="text-[10px] text-muted-foreground/40">
              {cancelledTasks.length} cancelled
            </div>
          {/if}
        {/if}
      </div>
    {/snippet}

    <!-- Bar visualization -->
    <div class={cn('flex items-end cursor-default', className)} style:gap>
      {#each taskBars as status}
        <div
          class="rounded-[0.5px]"
          style:width={barWidth}
          style:height={barHeight}
          style:background-color={barColor[status]}
        ></div>
      {/each}
    </div>
  </Tooltip>
{/if}

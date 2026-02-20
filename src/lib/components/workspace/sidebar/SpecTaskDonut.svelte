<script lang="ts">
  interface TaskStats {
    total: number;
    completed: number;
    inProgress: number;
  }

  interface Props {
    taskStats: TaskStats;
    size?: number;
    strokeWidth?: number;
  }

  let { taskStats, size = 16, strokeWidth = 3 }: Props = $props();

  const radius = $derived((size - strokeWidth) / 2);
  const circumference = $derived(2 * Math.PI * radius);
  const completedPct = $derived(taskStats.total > 0 ? taskStats.completed / taskStats.total : 0);
  const inProgressPct = $derived(taskStats.total > 0 ? taskStats.inProgress / taskStats.total : 0);
  const completedOffset = $derived(circumference * (1 - completedPct));
  const inProgressOffset = $derived(circumference * (1 - inProgressPct));
</script>

{#if taskStats.total > 0}
  <div class="flex items-center gap-1.5">
    <svg width={size} height={size} class="transform -rotate-90">
      <!-- Background ring (not done) -->
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        stroke-width={strokeWidth}
        class="text-muted-foreground/20"
      />
      <!-- In progress arc (primary) -->
      {#if taskStats.inProgress > 0}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          stroke-width={strokeWidth}
          stroke-dasharray={circumference}
          stroke-dashoffset={inProgressOffset}
          stroke-linecap="round"
          class="text-primary"
          style="transform-origin: center; transform: rotate({completedPct * 360}deg);"
        />
      {/if}
      <!-- Completed arc (emerald) -->
      {#if taskStats.completed > 0}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          stroke-width={strokeWidth}
          stroke-dasharray={circumference}
          stroke-dashoffset={completedOffset}
          stroke-linecap="round"
          class="text-emerald-500"
        />
      {/if}
    </svg>
    <span
      class={taskStats.completed === taskStats.total
        ? 'text-emerald-600 dark:text-emerald-400'
        : 'text-muted-foreground'}
    >
      {taskStats.completed} / {taskStats.total} tasks
    </span>
  </div>
{:else}
  <span class="text-muted-foreground">No tasks</span>
{/if}

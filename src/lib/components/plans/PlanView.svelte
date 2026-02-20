<!-- Task Item Component -->

<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { fade, slide } from 'svelte/transition';
  import { toast } from 'svelte-sonner';
  import { AgentId } from '$shared/types/branded-ids';
  import { planManager } from '../../../features/acp-official/plans/plan-manager';
  import type {
    SessionPlan,
    EnhancedPlanEntry,
  } from '../../../features/acp-official/plans/plan-manager';
  import PlanTaskItem from './PlanTaskItem.svelte';

  interface Props {
    sessionId: string;
    compact?: boolean;
  }

  let { sessionId, compact = false }: Props = $props();

  let plan: SessionPlan | undefined = $state(undefined);
  let expandedTasks = $state(new Set<string>());
  let hoveredTask: string | null = $state(null);

  function toggleTask(taskId: string) {
    if (expandedTasks.has(taskId)) {
      expandedTasks.delete(taskId);
    } else {
      expandedTasks.add(taskId);
    }
    expandedTasks = expandedTasks;
  }

  function getStatusIcon(status?: string) {
    switch (status) {
      case 'completed':
        return '✅';
      case 'failed':
        return '❌';
      case 'in_progress':
        return '⏳';
      case 'cancelled':
        return '⛔';
      case 'pending':
        return '⭕';
      default:
        return '⭕';
    }
  }

  function getStatusColor(status?: string) {
    switch (status) {
      case 'completed':
        return 'text-green-600 dark:text-green-400';
      case 'failed':
        return 'text-red-600 dark:text-red-400';
      case 'in_progress':
        return 'text-blue-600 dark:text-blue-400';
      case 'cancelled':
        return 'text-gray-500 dark:text-gray-400';
      case 'pending':
        return 'text-yellow-600 dark:text-yellow-400';
      default:
        return 'text-gray-400 dark:text-gray-500';
    }
  }

  function handlePlanUpdate(updatedPlan: SessionPlan) {
    if (updatedPlan.sessionId === sessionId) {
      plan = updatedPlan;
    }
  }

  function exportPlan() {
    if (!plan) return;
    const markdown = planManager.exportAsMarkdown(sessionId as AgentId);
    navigator.clipboard.writeText(markdown);
    toast.success('Plan copied to clipboard');
  }

  onMount(() => {
    plan = planManager.getPlan(sessionId as AgentId);
    planManager.on('plan:updated', handlePlanUpdate);
  });

  onDestroy(() => {
    planManager.off('plan:updated', handlePlanUpdate);
  });
</script>

{#if plan && plan.entries.length > 0}
  <div
    class={`bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 ${compact ? 'p-3 text-sm' : 'p-4'}`}
    transition:fade={{ duration: 200 }}
  >
    <!-- Header -->
    <div class="flex items-center justify-between mb-4">
      <div class="flex items-center gap-3">
        <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300">Execution Plan</h3>
        <span class="text-xs text-gray-500 dark:text-gray-400">
          {plan.completedTasks}/{plan.totalTasks} tasks
        </span>
      </div>

      <button
        class="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
        onclick={exportPlan}
        title="Copy as Markdown"
      >
        📋
      </button>
    </div>

    <!-- Progress Bar -->
    <div class="mb-4">
      <div class="flex items-center justify-between text-xs mb-1">
        <span class="text-gray-600 dark:text-gray-400">Progress</span>
        <span class="font-medium text-gray-700 dark:text-gray-300">{plan.progress}%</span>
      </div>
      <div class="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          class="h-full bg-linear-to-r from-blue-500 to-blue-600 transition-all duration-500"
          style="width: {plan.progress}%"
        ></div>
      </div>
      {#if plan.failedTasks > 0}
        <div class="mt-1 text-xs text-red-600 dark:text-red-400">
          {plan.failedTasks} task{plan.failedTasks === 1 ? '' : 's'} failed
        </div>
      {/if}
    </div>

    <!-- Task List -->
    <div class="space-y-1">
      {#each plan.entries as entry (entry.id)}
        <PlanTaskItem
          {entry}
          {compact}
          expanded={expandedTasks.has(entry.id)}
          hovered={hoveredTask === entry.id}
          indent={0}
          isExpanded={(id) => expandedTasks.has(id)}
          hoveredId={hoveredTask}
          ontoggle={(id) => toggleTask(id)}
          onmouseenter={() => (hoveredTask = entry.id)}
          onmouseleave={() => (hoveredTask = null)}
        />
      {/each}
    </div>
  </div>
{/if}

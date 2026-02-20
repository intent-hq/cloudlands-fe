<script lang="ts">
  import { slide } from 'svelte/transition';
  import Self from './PlanTaskItem.svelte';
  import type { EnhancedPlanEntry } from '$features/acp-official/plans/plan-manager';

  interface Props {
    entry: EnhancedPlanEntry;
    compact?: boolean;
    expanded?: boolean;
    hovered?: boolean;
    indent?: number;
    isExpanded?: (id: string) => boolean;
    hoveredId?: string | null;
    ontoggle?: (id: string) => void;
    onmouseenter?: () => void;
    onmouseleave?: () => void;
  }

  let {
    entry,
    compact = false,
    expanded = false,
    hovered = false,
    indent = 0,
    isExpanded,
    hoveredId,
    ontoggle,
    onmouseenter,
    onmouseleave,
  }: Props = $props();

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

  function handleToggle() {
    if (entry.children && entry.children.length > 0) {
      ontoggle?.(entry.id);
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleToggle();
    }
  }

  function handleChildToggle(id: string) {
    ontoggle?.(id);
  }
</script>

<!-- Container -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="relative" style="padding-left: {indent * 20}px" {onmouseenter} {onmouseleave}>
  <!-- Header row -->
  <div
    class={`flex items-center gap-2 py-1.5 px-2 rounded cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50 ${hovered ? 'bg-gray-100 dark:bg-gray-700' : ''}`}
    role="button"
    tabindex="0"
    onclick={handleToggle}
    onkeydown={handleKeydown}
  >
    {#if entry.children && entry.children.length > 0}
      <span
        class="text-xs text-gray-400 transition-transform"
        class:rotate-90={isExpanded?.(entry.id)}
      >
        ▶
      </span>
    {/if}

    <span class="text-sm {getStatusColor(entry.status)}">
      {entry.icon || getStatusIcon(entry.status)}
    </span>

    <span
      class="flex-1 text-gray-700 dark:text-gray-300"
      class:line-through={entry.status === 'completed'}
      class:opacity-60={entry.status === 'completed'}
    >
      {entry.title}
    </span>

    {#if entry.status === 'in_progress' && entry.progress !== undefined}
      <span class="relative w-16 h-1.5 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
        <span class="absolute inset-y-0 left-0 bg-blue-500" style="width: {entry.progress}%"></span>
      </span>
    {/if}

    {#if entry.duration}
      <span class="text-xs text-gray-500 dark:text-gray-400"
        >{Math.round(entry.duration / 1000)}s</span
      >
    {/if}
  </div>

  <!-- Description -->
  {#if !compact && entry.description && isExpanded?.(entry.id)}
    <div
      class="text-sm text-gray-600 dark:text-gray-400 pl-8 pr-2 py-1"
      transition:slide={{ duration: 200 }}
    >
      {entry.description}
    </div>
  {/if}

  <!-- Children -->
  {#if entry.children && isExpanded?.(entry.id)}
    <div
      class="ml-4 border-l border-gray-200 dark:border-gray-700"
      transition:slide={{ duration: 200 }}
    >
      {#each entry.children as child (child.id)}
        <Self
          entry={child}
          {compact}
          expanded={isExpanded?.(child.id)}
          hovered={hoveredId === child.id}
          indent={(indent ?? 0) + 1}
          {isExpanded}
          {hoveredId}
          ontoggle={handleChildToggle}
        />
      {/each}
    </div>
  {/if}
</div>

<script lang="ts">
  import { fade } from 'svelte/transition';
  import Tooltip from '$lib/components/ui/tooltip/Tooltip.svelte';

  /**
   * AgentBadge - Badge showing count of active agents
   * Displays with smooth scale and fade animations
   */

  interface Props {
    count?: number;
    class?: string;
  }

  let { count = 0, class: className = '' }: Props = $props();
  let prevCount = $state(0);
  let isUpdating = $state(false);

  $effect(() => {
    if (count !== prevCount) {
      isUpdating = true;
      prevCount = count;
      const timer = setTimeout(() => {
        isUpdating = false;
      }, 300);
      return () => clearTimeout(timer);
    }
  });

  const tooltip = $derived(count === 1 ? '1 unread response' : `${count} unread responses`);
</script>

{#if count > 0}
  <Tooltip content={tooltip} side="bottom" size="sm">
    <div
      class="agent-badge {className}"
      class:updating={isUpdating}
      transition:fade={{ duration: 200 }}
      aria-label={tooltip}
    >
      <span class="badge-text">{count}</span>
    </div>
  </Tooltip>
{/if}

<style>
  .agent-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.125rem;
    height: 1.125rem;
    padding: 0 0.25rem;
    border-radius: 0.25rem;
    background-color: hsl(var(--muted));
    border: none;
    font-size: 0.5rem;
    font-weight: 600;
    color: hsl(var(--muted-foreground));
    flex-shrink: 0;
    animation: badge-scale-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
    will-change: transform, opacity;
  }

  .agent-badge.updating {
    animation: badge-pulse 0.3s cubic-bezier(0.4, 0, 0.6, 1);
  }

  .badge-text {
    display: block;
    line-height: 1;
  }

  @keyframes badge-scale-in {
    from {
      opacity: 0;
      transform: scale(0.8);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  @keyframes badge-pulse {
    0% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.1);
    }
    100% {
      transform: scale(1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .agent-badge {
      animation: none;
    }

    .agent-badge.updating {
      animation: none;
    }
  }
</style>

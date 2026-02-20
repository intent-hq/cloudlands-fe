<script lang="ts">
  /**
   * LineChangeStats Component
   *
   * Displays line addition and deletion statistics in a compact format.
   * Can be used in hover cards, panels, and other UI elements.
   */

  import { cn } from '$lib/utils';

  interface Props {
    additions?: number;
    deletions?: number;
    showZero?: boolean;
    size?: 'xs' | 'sm' | 'md' | 'lg';
    inline?: boolean;
    loading?: boolean;
    class?: string;
  }

  let {
    additions = 0,
    deletions = 0,
    showZero = false,
    size = 'sm',
    inline = true,
    loading = false,
    class: className = '',
  }: Props = $props();

  // Only show if there are changes or showZero is true
  let shouldShow = $derived(showZero || additions > 0 || deletions > 0 || loading);

  // Size classes
  let sizeClasses = $derived.by(() => {
    switch (size) {
      case 'xs':
        return 'text-[10px] gap-1';
      case 'sm':
        return 'text-xs gap-1.5';
      case 'md':
        return 'text-sm gap-2';
      case 'lg':
        return 'text-base gap-2.5';
      default:
        return 'text-xs gap-1.5';
    }
  });

  // Format number for display
  function formatNumber(num: number): string {
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(1)}M`;
    } else if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}K`;
    }
    return num.toString();
  }
</script>

{#if shouldShow}
  <div
    class={cn(
      'whitespace-nowrap',
      inline ? 'inline-flex' : 'flex',
      'items-center font-mono',
      sizeClasses,
      className,
    )}
  >
    {#if loading}
      <span class="text-muted-foreground animate-pulse"> Calculating... </span>
    {:else}
      {#if additions > 0 || showZero}
        <span class="text-green-600 dark:text-green-400 flex items-center gap-0.5">
          <span class="opacity-70">+</span>
          <span>{formatNumber(additions)}</span>
        </span>
      {/if}

      {#if deletions > 0 || showZero}
        <span class="text-red-600 dark:text-red-400 flex items-center gap-0.5">
          <span class="opacity-70">-</span>
          <span>{formatNumber(deletions)}</span>
        </span>
      {/if}

      {#if !additions && !deletions && !showZero}
        <span class="text-muted-foreground"> No changes </span>
      {/if}
    {/if}
  </div>
{/if}

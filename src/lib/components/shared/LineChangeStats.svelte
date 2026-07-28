<script lang="ts">
  /**
   * LineChangeStats Component
   *
   * Displays line addition and deletion statistics in a compact format.
   * Can be used in hover cards, panels, and other UI elements.
   */

  import { cn } from '$lib/utils';
  import { formatNumber } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';

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
        return 'text-ui gap-1';
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
  function formatCompact(num: number): string {
    return formatNumber(num, { notation: 'compact' });
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
      <span class="text-subtle animate-pulse"> {m.shared_lineChangeStats_calculating_label()} </span>
    {:else}
      {#if additions > 0 || showZero}
        <span class="text-green-600 dark:text-green-400 flex items-center gap-0.5">
          <span class="opacity-70">+</span>
          <span>{formatCompact(additions)}</span>
        </span>
      {/if}

      {#if deletions > 0 || showZero}
        <span class="text-red-600 dark:text-red-400 flex items-center gap-0.5">
          <span class="opacity-70">-</span>
          <span>{formatCompact(deletions)}</span>
        </span>
      {/if}

      {#if !additions && !deletions && !showZero}
        <span class="text-subtle"> {m.shared_lineChangeStats_noChanges_label()} </span>
      {/if}
    {/if}
  </div>
{/if}

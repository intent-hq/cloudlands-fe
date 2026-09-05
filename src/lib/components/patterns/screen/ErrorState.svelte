<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import type { Snippet } from 'svelte';
  import EmptyState from './EmptyState.svelte';

  let {
    message,
    retryLabel,
    onRetry,
    details,
    detailsLabel,
    icon,
    class: className,
  }: {
    message: Snippet;
    retryLabel?: string;
    onRetry?: () => void;
    details?: Snippet;
    detailsLabel?: string;
    icon?: Snippet;
    class?: string;
  } = $props();
</script>

{#snippet actions()}
  {#if onRetry && retryLabel}<Button variant="outline" onclick={onRetry}>{retryLabel}</Button>{/if}
{/snippet}

<EmptyState title={message} {icon} {actions} class={className}>
  {#if details && detailsLabel}
    <details class="mt-4 text-left text-sm text-muted-foreground">
      <summary class="cursor-pointer font-medium text-foreground">{detailsLabel}</summary>
      <div class="mt-2">{@render details()}</div>
    </details>
  {/if}
</EmptyState>

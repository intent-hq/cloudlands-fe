<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import type { StateDensity } from '../state-geometry';
  import EmptyState from './EmptyState.svelte';

  interface Props extends Omit<HTMLAttributes<HTMLElement>, 'children' | 'title'> {
    message: Snippet;
    retryLabel?: string;
    onRetry?: () => void;
    details?: Snippet;
    detailsLabel?: string;
    icon?: Snippet;
    density?: StateDensity;
    severity?: 'routine' | 'danger';
    inset?: boolean;
    class?: string;
  }

  let {
    message,
    retryLabel,
    onRetry,
    details,
    detailsLabel,
    icon,
    density = 'default',
    severity = 'routine',
    inset = false,
    class: className,
    ...restProps
  }: Props = $props();
</script>

<EmptyState
  description={message}
  {icon}
  actionLabel={retryLabel}
  onAction={onRetry}
  {density}
  {severity}
  {inset}
  class={className}
  role="alert"
  data-state-kind="error"
  {...restProps}
>
  {#if details && detailsLabel}
    <details class="mt-3 text-left type-caption text-muted-foreground">
      <summary class="cursor-pointer font-normal text-muted-foreground">{detailsLabel}</summary>
      <div class="mt-1.5">{@render details()}</div>
    </details>
  {/if}
</EmptyState>

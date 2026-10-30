<script lang="ts">
  /**
   * Collapsed form of a composer card (the Q&A card and the secret-request
   * stack): one bordered bar whose main button expands the card, with an
   * optional trailing action such as Dismiss. The expand button holds no
   * nested controls, so the action stays a separate tab stop.
   */
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import { Button } from '$lib/components/ui/button';

  interface Props extends HTMLAttributes<HTMLDivElement> {
    title: string;
    count?: number;
    expandLabel: string;
    onExpand: () => void;
    action?: Snippet;
    expandTestId?: string;
  }

  let { title, count, expandLabel, onExpand, action, expandTestId, ...rest }: Props = $props();
</script>

<div
  {...rest}
  class="flex w-full min-w-0 items-center rounded-(--radius-large) border border-border bg-card"
>
  <Button
    variant="plain"
    wrapContent={false}
    class="h-auto min-w-0 flex-1 justify-start gap-2 px-3 py-2.5 text-left sm:px-4"
    aria-expanded={false}
    onclick={onExpand}
    data-testid={expandTestId}
  >
    <span class="flex min-w-0 flex-1 items-center gap-1">
      <span class="truncate type-caption font-medium text-foreground">{title}</span>
      {#if count !== undefined}
        <span class="shrink-0 type-caption text-muted-foreground">{count}</span>
      {/if}
    </span>
    <span class="min-w-0 max-w-[40%] truncate type-caption text-muted-foreground">
      {expandLabel}
    </span>
  </Button>
  {#if action}
    <div class="shrink-0 pr-1 sm:pr-2">
      {@render action()}
    </div>
  {/if}
</div>

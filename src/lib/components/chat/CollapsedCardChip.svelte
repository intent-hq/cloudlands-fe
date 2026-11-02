<script lang="ts">
  /**
   * Collapsed form of a composer card (the Q&A card and the secret-request
   * stack): one bordered bar whose main button expands the card, with an
   * optional trailing Dismiss. The expand button holds no nested controls, so
   * Dismiss stays a separate tab stop. Callers that move focus to the chip
   * bind `expandButton`.
   */
  import type { HTMLAttributes } from 'svelte/elements';
  import { Button } from '$lib/components/ui/button';

  interface Dismiss {
    label: string;
    tooltip: string;
    onDismiss: () => void;
    testId?: string;
  }

  interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'class' | 'title'> {
    /** Visible heading inside the expand button. */
    heading: string;
    /** Optional count shown after the heading. */
    count?: number;
    /** Trailing hint inside the expand button, e.g. "Click to expand". */
    hint: string;
    onExpand: () => void;
    dismiss?: Dismiss;
    expandTestId?: string;
    expandButton?: HTMLElement | null;
  }

  let {
    heading,
    count,
    hint,
    onExpand,
    dismiss,
    expandTestId,
    expandButton = $bindable(null),
    ...rest
  }: Props = $props();
</script>

<div
  {...rest}
  class="flex w-full min-w-0 items-center rounded-(--radius-large) border border-border bg-card"
>
  <Button
    bind:ref={expandButton}
    variant="plain"
    wrapContent={false}
    class="h-auto min-w-0 flex-1 justify-start gap-2 px-3 py-2.5 text-left sm:px-4"
    aria-expanded={false}
    onclick={onExpand}
    data-testid={expandTestId}
  >
    <span class="flex min-w-0 flex-1 items-center gap-1">
      <span class="truncate type-caption font-medium text-foreground">{heading}</span>
      {#if count !== undefined}
        <span class="shrink-0 type-caption text-muted-foreground">{count}</span>
      {/if}
    </span>
    <span class="min-w-0 max-w-[40%] truncate type-caption text-muted-foreground">
      {hint}
    </span>
  </Button>
  {#if dismiss}
    <div class="shrink-0 pr-1 sm:pr-2">
      <Button
        variant="ghost"
        size="compact"
        class="text-danger"
        title={dismiss.tooltip}
        onclick={dismiss.onDismiss}
        data-testid={dismiss.testId}
      >
        {dismiss.label}
      </Button>
    </div>
  {/if}
</div>

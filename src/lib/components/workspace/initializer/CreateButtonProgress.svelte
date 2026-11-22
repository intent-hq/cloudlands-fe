<!-- Live provisioning labels and a determinate bar. Keep the bar outside
     the Button content slot so it stays at the button’s bottom edge. Git's
     download size and rate while cloning sit in a caption just below the
     button: numbers in the label would restart its text motion on every
     frame. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { toStore } from 'svelte/store';
  import { cn } from '$lib/utils';
  import { selectWorkspaceCreateProgress } from '$store/renderer/slices/workspace-create-progress/workspace-create-progress-selectors';
  import { createProgressLabel } from './create-progress-label';
  import { createProgressTransferLabel } from './create-progress-transfer';

  let {
    progressId,
    fallbackLabel,
    children,
    class: className,
  }: {
    progressId: string | null;
    fallbackLabel: string;
    children: Snippet<[label: string]>;
    class?: string;
  } = $props();

  const entry$ = selectWorkspaceCreateProgress(toStore(() => progressId));

  // Keep the bar monotonic and clamp its width and accessible value together.
  let maxPercent = $state(0);
  let lastProgressId: string | null = null;
  $effect(() => {
    const percent = Math.min($entry$?.percent ?? 0, 100);
    if (progressId !== lastProgressId) {
      lastProgressId = progressId;
      maxPercent = percent;
    } else if (percent > maxPercent) maxPercent = percent;
  });

  const live = $derived($entry$?.sawFrame === true);
  const transfer = $derived(
    $entry$?.transfer ? createProgressTransferLabel($entry$.transfer) : null,
  );
</script>

<!-- inline-flex keeps the wrapped Button's line-box geometry identical to an
     unwrapped one, so the button's footprint does not change while creating.
     The outer box never clips, so the Button's elevation shadow stays visible;
     the inner overlay layer clips the bar to the button radius. -->
<div class={cn('relative inline-flex', className)}>
  {@render children(live && $entry$ ? createProgressLabel($entry$) : fallbackLabel)}
  {#if live && $entry$}
    <div class="pointer-events-none absolute inset-0 overflow-hidden rounded-(--radius-medium)">
      <div
        class="absolute bottom-0 left-0 h-[2px] bg-primary-foreground/80 transition-[width] duration-spring-slow ease-spring-slow motion-reduce:transition-none"
        style="width: {maxPercent}%"
        role="progressbar"
        aria-label={createProgressLabel($entry$)}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={maxPercent}
        data-testid="create-progress-bar"
      ></div>
    </div>
  {/if}
  {#if live && transfer}
    <!-- Absolutely positioned, so it takes no layout space: the button sits
         in a bottom-pinned footer and must not move while a create runs. -->
    <div
      class="pointer-events-none absolute inset-x-0 top-full mt-1 truncate text-center text-xs text-subtle tabular-nums"
      aria-hidden="true"
      data-testid="create-progress-detail"
    >
      {transfer}
    </div>
  {/if}
</div>

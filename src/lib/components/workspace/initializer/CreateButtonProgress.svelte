<!-- Live provisioning labels and a determinate bar. Keep the bar outside
     the Button content slot so it stays at the button’s bottom edge. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { cn } from '$lib/utils';
  import { selectWorkspaceCreateProgress } from '$store/renderer/slices/workspace-create-progress/workspace-create-progress-selectors';
  import { createProgressLabel } from './create-progress-label';

  let {
    progressId,
    fallbackLabel,
    children,
    class: className,
  }: {
    progressId: string;
    fallbackLabel: string;
    children: Snippet<[label: string]>;
    class?: string;
  } = $props();

  // Selector readables bind at component init only (STATE_MANAGEMENT.md);
  // the caller keys this component's lifetime to one create, so the initial
  // progressId is the only one it ever renders.
  // svelte-ignore state_referenced_locally
  const entry$ = selectWorkspaceCreateProgress(progressId);

  // Keep the bar monotonic and clamp its width and accessible value together.
  let maxPercent = $state(0);
  $effect(() => {
    const percent = Math.min($entry$?.percent ?? 0, 100);
    if (percent > maxPercent) maxPercent = percent;
  });

  const live = $derived($entry$?.sawFrame === true);
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
</div>

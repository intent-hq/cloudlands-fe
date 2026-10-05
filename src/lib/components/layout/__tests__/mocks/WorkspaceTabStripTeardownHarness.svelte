<script lang="ts">
  import WorkspaceTabStrip from '../../WorkspaceTabStrip.svelte';
  import type { WorkspaceTabBorderMaskBounds } from '../../titlebar-geometry';
  import MockTeardownEffectProbe from './MockTeardownEffectProbe.svelte';

  // Mirrors WindowTitleBar: the strip's callbacks feed parent `$state`, and a
  // sibling block conditioned on that state mounts a component that creates
  // effects of its own.
  let {
    activeWorkspaceId = 'ws-1',
    siblingGate = 'bounds-cleared',
    measureInsetWhileTracking,
    onError,
    onProbeMounted,
  }: {
    activeWorkspaceId?: string | null;
    siblingGate?: 'bounds-cleared' | 'tracking-idle';
    measureInsetWhileTracking?: () => number;
    onError?: (error: unknown) => void;
    onProbeMounted?: () => void;
  } = $props();

  let showSibling = $state(false);
  let trackingKey = $state(0);
  let measuredInsetPx = $state(0);
  let activeTabBounds = $state<WorkspaceTabBorderMaskBounds | null>(null);
  let activeTabTracking = $state(false);
  const horizontalPositionTrackingKey = $derived(trackingKey + measuredInsetPx);
  const siblingOpen = $derived(
    showSibling &&
      (siblingGate === 'bounds-cleared' ? activeTabBounds === null : !activeTabTracking),
  );

  // Mirrors WindowTitleBar's layout measurement: a parent effect that runs in the
  // same batch as the strip's tracking report writes state feeding the key.
  $effect(() => {
    if (!measureInsetWhileTracking || !activeTabTracking) return;
    measuredInsetPx = measureInsetWhileTracking();
  });

  export function update(next: { showSibling?: boolean; horizontalPositionTrackingKey?: number }) {
    if (next.showSibling !== undefined) showSibling = next.showSibling;
    if (next.horizontalPositionTrackingKey !== undefined) {
      trackingKey = next.horizontalPositionTrackingKey;
    }
  }
</script>

<svelte:boundary onerror={(error) => onError?.(error)}>
  <div class="window-title-bar">
    <WorkspaceTabStrip
      {activeWorkspaceId}
      {horizontalPositionTrackingKey}
      onActiveTabBoundsChange={(bounds) => (activeTabBounds = bounds)}
      onActiveTabTrackingChange={(tracking) => (activeTabTracking = tracking)}
    />
  </div>
  <div
    data-active-tab-tracking={activeTabTracking}
    data-active-tab-bounds={activeTabBounds ? 'set' : 'none'}
  ></div>
  {#if siblingOpen}
    <MockTeardownEffectProbe onMounted={onProbeMounted} />
  {/if}
  {#snippet failed()}
    <div data-teardown-boundary-failed></div>
  {/snippet}
</svelte:boundary>

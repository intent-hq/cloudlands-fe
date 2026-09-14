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
    onError,
    onProbeMounted,
  }: {
    activeWorkspaceId?: string | null;
    siblingGate?: 'bounds-cleared' | 'tracking-idle';
    onError?: (error: unknown) => void;
    onProbeMounted?: () => void;
  } = $props();

  let showSibling = $state(false);
  let horizontalPositionTrackingKey = $state(0);
  let activeTabBounds = $state<WorkspaceTabBorderMaskBounds | null>(null);
  let activeTabTracking = $state(false);
  const siblingOpen = $derived(
    showSibling &&
      (siblingGate === 'bounds-cleared' ? activeTabBounds === null : !activeTabTracking),
  );

  export function update(next: { showSibling?: boolean; horizontalPositionTrackingKey?: number }) {
    if (next.showSibling !== undefined) showSibling = next.showSibling;
    if (next.horizontalPositionTrackingKey !== undefined) {
      horizontalPositionTrackingKey = next.horizontalPositionTrackingKey;
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

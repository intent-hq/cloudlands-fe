<script lang="ts">
  import type { Readable } from 'svelte/store';
  import WorkspaceTabStrip from '../../WorkspaceTabStrip.svelte';
  import type { WorkspaceTabBorderMaskBounds } from '../../titlebar-geometry';
  import WorkspaceTabLivenessSidebar from './WorkspaceTabLivenessSidebar.svelte';

  let {
    route,
    panel,
    onToggle,
    onLeave,
    readBeforeWrite = true,
    onBounds,
  }: {
    route: Readable<string | null>;
    panel: Readable<string | null>;
    onToggle: () => void;
    onLeave: () => void;
    readBeforeWrite?: boolean;
    onBounds: (bounds: WorkspaceTabBorderMaskBounds | null) => void;
  } = $props();

  let activeTabBounds = $state<WorkspaceTabBorderMaskBounds | null>(null);
  let activeTabTracking = $state(false);
  let localClicks = $state(0);
  let mirror = $state(0);
  let lastMirror: string | null = null;
  let mirrorCount = 0;
  const panelOffset = $derived($panel === null ? 0 : 288);

  // A constructed scheduler stressor, not a copy of an identified app action:
  // first read/write of local state during the same keyed-parent update as the
  // real strip's bounds action. The no-read control preserves the writes.
  function trackMirror(_node: HTMLElement, _value: string | null) {
    return {
      update(next: string | null) {
        if (next === lastMirror) return;
        lastMirror = next;
        mirror = readBeforeWrite ? mirror + 1 : ++mirrorCount;
      },
    };
  }
</script>

<div class="window-title-bar">
  <WorkspaceTabLivenessSidebar {panel} {onToggle} />
  <output data-mirror>{mirror}</output>
  {#each $route ? ['strip', 'mirror'] : ['strip', 'mirror'] as section (section)}
    {#if section === 'strip'}
      <WorkspaceTabStrip
        activeWorkspaceId={$route}
        horizontalPositionTrackingKey={panelOffset}
        onActiveTabBoundsChange={(bounds) => {
          onBounds(bounds);
          activeTabBounds = bounds;
        }}
        onActiveTabTrackingChange={(tracking) => (activeTabTracking = tracking)}
      />
    {:else}
      <div use:trackMirror={$route}></div>
    {/if}
  {/each}
  {#if activeTabBounds}
    <div
      data-mask
      data-tracking={activeTabTracking}
      style:left="{activeTabBounds.left}px"
      style:width="{activeTabBounds.width}px"
    ></div>
  {/if}
  <button data-local onclick={() => localClicks++}>{localClicks}</button>
  <button data-leave onclick={onLeave}>Leave workspace</button>
</div>

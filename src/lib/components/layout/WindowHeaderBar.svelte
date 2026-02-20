<script lang="ts">
  /**
   * WindowHeaderBar - Toggle button for the SpacesSidebar
   *
   * Positioned to the right of the traffic lights.
   * Controls visibility of the leftmost sidebar with space icons.
   */

  import { faTableColumns } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { layoutSettings } from '$features/layout/layout-settings.svelte';
  import { Tooltip } from '$lib/components/ui/tooltip';

  // Detect platform for conditional positioning
  const isMac = $derived.by(() => {
    if (typeof navigator === 'undefined') return false;
    return (
      // @ts-expect-error - userAgentData is not in all browsers
      navigator.userAgentData?.platform === 'macOS' ||
      /Mac|iPhone|iPad|iPod/.test(navigator.userAgent)
    );
  });

  // Traffic lights end at ~75px on macOS, position toggle button there
  // On Windows, there are no traffic lights, so position at the left edge
  // Top offset adds a few pixels below the traffic lights center
  const LEFT_OFFSET = $derived(isMac ? 75 : 8);
  const TOP_OFFSET = 8; // A few pixels down from top
</script>

<!-- Toggle button positioned to the right of traffic lights -->
<div
  class="fixed z-[100] flex items-center"
  style="left: {LEFT_OFFSET}px; top: {TOP_OFFSET}px;"
>
  <!-- SpacesSidebar toggle button -->
  <Tooltip
    content={layoutSettings.spacesSidebarCollapsed ? 'Show spaces' : 'Hide spaces'}
    side="right"
  >
    <button
      class="sidebar-toggle-button p-1.5 rounded transition-colors"
      class:active={!layoutSettings.spacesSidebarCollapsed}
      onclick={() => layoutSettings.toggleSpacesSidebar()}
    >
      <Fa icon={faTableColumns} class="w-4 h-4" />
    </button>
  </Tooltip>
</div>

<style>
  .sidebar-toggle-button {
    color: hsl(var(--muted-foreground));
  }

  .sidebar-toggle-button:hover {
    color: hsl(var(--foreground));
  }

  .sidebar-toggle-button.active {
    color: hsl(var(--foreground));
  }
</style>

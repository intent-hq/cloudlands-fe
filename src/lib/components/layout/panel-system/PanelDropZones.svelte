<script lang="ts">
  /**
   * PanelDropZones - Visual overlay showing where a dragged tab will land
   *
   * Shows a single overlay indicating the drop position:
   * - Left half highlighted for "split left"
   * - Right half for "split right"
   * - Top half for "split top"
   * - Bottom half for "split bottom"
   * - Full panel for "add to panel" (center)
   *
   * Positioned below the tab bar to avoid overlap.
   */

  import { m } from '$shared/paraglide/messages.js';
  import { cn } from '$lib/utils';

  interface Props {
    /** Which zone is currently hovered */
    activeZone: 'top' | 'bottom' | 'left' | 'right' | 'center' | null;
    /** Is the drag operation active? */
    isActive: boolean;
  }

  let { activeZone, isActive }: Props = $props();

  // Get position classes based on active zone
  // Shows where the new split/tab will appear
  const zoneStyles = {
    left: 'left-0 top-0 bottom-0 w-1/2',
    right: 'right-0 top-0 bottom-0 w-1/2',
    top: 'left-0 right-0 top-0 h-1/2',
    bottom: 'left-0 right-0 bottom-0 h-1/2',
    center: 'inset-0',
  } as const;

  const zoneLabels = {
    left: () => m.layout_panelDropZones_splitLeft_label(),
    right: () => m.layout_panelDropZones_splitRight_label(),
    top: () => m.layout_panelDropZones_splitTop_label(),
    bottom: () => m.layout_panelDropZones_splitBottom_label(),
    center: () => m.layout_panelDropZones_addToPanel_label(),
  } as const;
</script>

{#if isActive && activeZone}
  <!-- Container positioned below the tab bar (top-9 = 36px for tab bar height) -->
  <div class="absolute top-9 left-0 right-0 bottom-0 pointer-events-none z-20">
    <!-- Single overlay showing where the tab will land -->
    <div
      class={cn(
        'absolute transition-all duration-150 flex items-center justify-center',
        'bg-primary/15',
        zoneStyles[activeZone],
      )}
    >
      <span class="text-sm font-medium text-primary px-3 py-1.5 bg-background/90 rounded-md shadow-sm">
        {zoneLabels[activeZone]()}
      </span>
    </div>
  </div>
{/if}

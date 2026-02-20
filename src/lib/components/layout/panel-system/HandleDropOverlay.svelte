<script lang="ts">
  /**
   * HandleDropOverlay - Global overlay for split handle drop zones
   *
   * Renders at the layout root level to avoid overflow clipping.
   * Shows a preview of where a new panel will be inserted when
   * dropping a tab on a split handle.
   *
   * The overlay spans across the split handle to show where the new
   * row/column will be inserted - it appears as a strip along the handle.
   *
   * Zone types:
   * - row-above: Horizontal strip at top of handle (new row above)
   * - row-below: Horizontal strip at bottom of handle (new row below)
   * - column-left: Vertical strip at left of handle (new column left)
   * - column-right: Vertical strip at right of handle (new column right)
   */

  import { tabDragStore } from '$lib/stores/tab-drag.store.svelte';

  // Get the active handle drop info from the global store
  let dropInfo = $derived(tabDragStore.activeHandleDrop);

  // Height/width of the overlay strip (mimics where new panel will appear)
  const OVERLAY_SIZE = 80;

  // Calculate overlay position based on container rect and zone type
  // The overlay spans the full width/height of the container to show where
  // the new row/column will be inserted
  let overlayStyle = $derived.by(() => {
    if (!dropInfo) return '';

    const { containerRect, zoneType } = dropInfo;

    switch (zoneType) {
      case 'row-above': {
        // Horizontal strip at the top of the container (full width)
        return `
          left: ${containerRect.left}px;
          top: ${containerRect.top}px;
          width: ${containerRect.width}px;
          height: ${OVERLAY_SIZE}px;
          border-radius: 0 0 8px 8px;
        `;
      }
      case 'row-below': {
        // Horizontal strip at the bottom of the container (full width)
        return `
          left: ${containerRect.left}px;
          top: ${containerRect.bottom - OVERLAY_SIZE}px;
          width: ${containerRect.width}px;
          height: ${OVERLAY_SIZE}px;
          border-radius: 8px 8px 0 0;
        `;
      }
      case 'column-left': {
        // Vertical strip at the left of the container (full height)
        return `
          left: ${containerRect.left}px;
          top: ${containerRect.top}px;
          width: ${OVERLAY_SIZE}px;
          height: ${containerRect.height}px;
          border-radius: 0 8px 8px 0;
        `;
      }
      case 'column-right': {
        // Vertical strip at the right of the container (full height)
        return `
          left: ${containerRect.right - OVERLAY_SIZE}px;
          top: ${containerRect.top}px;
          width: ${OVERLAY_SIZE}px;
          height: ${containerRect.height}px;
          border-radius: 8px 0 0 8px;
        `;
      }
      default:
        return '';
    }
  });
</script>

{#if dropInfo}
  <div class="handle-drop-overlay" style={overlayStyle}>
    <span class="drop-label">{dropInfo.label}</span>
  </div>
{/if}

<style>
  .handle-drop-overlay {
    position: fixed;
    display: flex;
    align-items: center;
    justify-content: center;
    background: hsl(var(--primary) / 0.15);
    pointer-events: none;
    z-index: 1000;
  }

  .drop-label {
    font-size: 0.75rem;
    font-weight: 500;
    color: hsl(var(--primary));
    background: hsl(var(--background) / 0.95);
    padding: 0.375rem 0.75rem;
    border-radius: 4px;
    white-space: nowrap;
    box-shadow: 0 2px 8px hsl(var(--foreground) / 0.1);
  }
</style>

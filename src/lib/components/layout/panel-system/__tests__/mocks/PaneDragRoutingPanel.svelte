<script lang="ts">
  import { flushSync } from 'svelte';
  import type { PanelState } from '$features/layout/panel-layout-adapter';
  import {
    PANE_DRAG_MIME,
    getDraggedPane,
    getPaneColumnDropZone,
    type PaneDropPlacement,
    type PaneDropZone,
  } from '../../panel-drag';

  let {
    panel,
    canCreateColumn = true,
    onPaneDropPreview,
  }: {
    panel: PanelState;
    canCreateColumn?: boolean;
    onPaneDropPreview?: (placement: PaneDropPlacement | null) => void;
  } = $props();

  let panelElement: HTMLElement;
  let activeDropZone: PaneDropZone | null = null;

  function recordPreviewAfterRootCapture() {
    flushSync();
    const preview = document.querySelector<HTMLElement>('[data-panel-layout-drag-preview]');
    window.dispatchEvent(
      new CustomEvent('pane-drag-preview-probe', {
        detail: preview?.dataset.panelLayoutDragPreview ?? null,
      }),
    );
  }

  function handleDragOver(event: DragEvent) {
    if (!event.dataTransfer?.types.includes(PANE_DRAG_MIME) || !getDraggedPane()) return;
    event.preventDefault();
    activeDropZone = getPaneColumnDropZone(
      event.clientX,
      panelElement.getBoundingClientRect(),
      canCreateColumn,
      activeDropZone,
    );
    onPaneDropPreview?.({ kind: 'panel', targetPanelId: panel.id, zone: activeDropZone });
  }
</script>

<div
  bind:this={panelElement}
  role="region"
  data-panel-id={panel.id}
  ondragovercapture={recordPreviewAfterRootCapture}
  ondragover={handleDragOver}
>
  <div data-note-content-surface>
    <div style="padding-left: 48px; padding-right: 48px" data-note-content-inset>
      {panel.id}
    </div>
  </div>
</div>

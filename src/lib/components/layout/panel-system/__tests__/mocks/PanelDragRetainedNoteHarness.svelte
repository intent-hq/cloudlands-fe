<script lang="ts">
  import { faNoteSticky } from '@fortawesome/free-solid-svg-icons';
  import { tabTypeRegistry } from '$features/layout/tab-types/registry';
  import { store as appStore } from '$store/renderer/store';
  import {
    clearPanelLayout,
    initializeLayout,
    setRestoreStatus,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import { startDrag } from '$store/renderer/slices/tab-state/tab-state-slice';
  import PanelLayout from '../../PanelLayout.svelte';
  import { PANE_DRAG_MIME, setDraggedPane } from '../../panel-drag';
  import PanelDragRetainedNoteTab from './PanelDragRetainedNoteTab.svelte';

  let { sourceSide }: { sourceSide: 'left' | 'right' } = $props();
  // svelte-ignore state_referenced_locally - test prop defines immutable initial state
  const initialSourceSide = $state.snapshot(sourceSide);

  appStore.init();
  tabTypeRegistry.register({
    type: 'note',
    component: PanelDragRetainedNoteTab,
    defaultWidthTier: 'medium',
    icon: faNoteSticky,
    defaultTitle: 'Note',
    categoryLabel: 'Notes',
  });
  const layoutId = `gutter-${initialSourceSide}`;
  const source = { type: 'panel' as const, panelId: 'source-panel' };
  const retained = { type: 'panel' as const, panelId: 'retained-panel' };
  appStore.dispatch(clearPanelLayout(layoutId));
  appStore.dispatch(
    initializeLayout(layoutId, {
      root: {
        type: 'split',
        direction: 'horizontal',
        sizes: [50, 50],
        children: initialSourceSide === 'left' ? [source, retained] : [retained, source],
      },
      panels: {
        'source-panel': {
          id: 'source-panel',
          tabs: [{ id: 'source-note', type: 'note', title: 'Source', closable: true }],
          activeTabId: 'source-note',
        },
        'retained-panel': {
          id: 'retained-panel',
          tabs: [{ id: 'retained-note', type: 'note', title: 'Retained', closable: true }],
          activeTabId: 'retained-note',
        },
      },
      focusedPanelId: 'retained-panel',
      canvasWidth: 800,
    }),
  );
  appStore.dispatch(setRestoreStatus(layoutId, 'restored'));

  function showRootPreview() {
    setDraggedPane({ tabId: 'source-note', panelId: 'source-panel' });
    appStore.dispatch(startDrag());
    const layout = document.querySelector<HTMLElement>('[data-panel-layout-motion]')!;
    const rect = layout.getBoundingClientRect();
    const dataTransfer = new DataTransfer();
    dataTransfer.setData(PANE_DRAG_MIME, 'source-note');
    layout.dispatchEvent(
      new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        clientX: initialSourceSide === 'left' ? rect.right - 1 : rect.left + 1,
        clientY: rect.top + 20,
        dataTransfer,
      }),
    );
  }
</script>

<button data-show-root-preview onclick={showRootPreview}>Show preview</button>
<div class="h-[420px] w-[816px] overflow-hidden">
  <PanelLayout workspaceId={layoutId} {layoutId} contained canvasSizing="viewport" />
</div>

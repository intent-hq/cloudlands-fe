<script lang="ts" module>
  /**
   * PanelContentRenderer stand-in that mirrors ChatPanel's file-drop
   * registration: agent tabs register a handler with the surrounding Panel
   * while active; other tab types register nothing.
   */
  export const droppedFiles: File[][] = [];
  export const dragChanges: boolean[] = [];
  export function resetFileDropSpies() {
    droppedFiles.length = 0;
    dragChanges.length = 0;
  }
</script>

<script lang="ts">
  import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';
  import { getPanelFileDropContext } from '../../panel-file-drop-context.svelte';

  let { tab, isActive = true }: { tab: PanelTab; isActive?: boolean } = $props();

  const context = getPanelFileDropContext();

  $effect(() => {
    if (!context || !isActive || tab.type !== 'agent') return;
    const handler = {
      onDrop: (files: File[]) => {
        droppedFiles.push(files);
      },
      onDragChange: (dragging: boolean) => {
        dragChanges.push(dragging);
      },
    };
    context.register(handler);
    return () => context.unregister(handler);
  });
</script>

<div data-testid="file-drop-registering-content"></div>

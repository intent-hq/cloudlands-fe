<script lang="ts" module>
  import type { PanelFileDropContext } from '../../panel-file-drop-context.svelte';
  import type { DropSplit } from '$lib/utils/drop-split';

  /**
   * PanelContentRenderer stand-in that mirrors ChatPanel's file-drop
   * registration: agent tabs register a handler with the surrounding Panel
   * while active; other tab types register nothing.
   */
  export const droppedFiles: DropSplit[] = [];
  export const dragChanges: boolean[] = [];
  /** The surrounding Panel's context, so tests can register replacement handlers. */
  export const contextRef: { current: PanelFileDropContext | null } = { current: null };
  export function resetFileDropSpies() {
    droppedFiles.length = 0;
    dragChanges.length = 0;
    contextRef.current = null;
  }
</script>

<script lang="ts">
  import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';
  import { getPanelFileDropContext } from '../../panel-file-drop-context.svelte';

  let { tab, isActive = true }: { tab: PanelTab; isActive?: boolean } = $props();

  const context = getPanelFileDropContext();
  contextRef.current = context;

  $effect(() => {
    if (!context || !isActive || tab.type !== 'agent') return;
    const handler = {
      onDrop: (drop: DropSplit) => {
        droppedFiles.push(drop);
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

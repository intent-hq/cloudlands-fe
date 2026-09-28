import { onDestroy, tick } from 'svelte';
import { scheduleLayoutWrite } from '$lib/utils/layout-phases';
import type { useOperationalPanel } from './operational-panel.svelte';
import type { WindowItem } from './operational-window-items';

/** A new tool may reserve its animated origin only during its admission window. */
export function createToolEntranceReservations(
  panel: Pick<ReturnType<typeof useOperationalPanel>, 'locate' | 'measuredHeight'>,
  entered: Set<string>,
) {
  const pending = new Map<string, string>();
  let revision = $state(0);
  let cancelWrite: (() => void) | undefined;
  let disposed = false;
  function settle() {
    if (cancelWrite || disposed) return;
    cancelWrite = scheduleLayoutWrite(async () => {
      // Admission publishes in this write phase. Let Svelte mount the selected
      // rows before deciding which tools actually started their entrance.
      await tick();
      cancelWrite = undefined;
      if (disposed) return;
      let changed = false;
      for (const [key, id] of pending) {
        if (
          !entered.has(id) ||
          !panel.locate(key)?.admitted ||
          panel.measuredHeight(key) !== undefined
        ) {
          // Deferred tools reserve natural geometry and do not replay a zero-
          // height entrance when a reader reaches them much later.
          entered.add(id);
          pending.delete(key);
          changed = true;
        }
      }
      if (changed) revision++;
      if (pending.size) settle();
    });
  }
  onDestroy(() => {
    disposed = true;
    cancelWrite?.();
    pending.clear();
  });
  return (item: WindowItem, animate: boolean): WindowItem => {
    void revision;
    if (item.block.type !== 'tool_use') return item;
    if (animate && !entered.has(item.block.id)) {
      pending.set(item.key, item.block.id);
      settle();
    }
    // Admitted growth is measured; unadmitted/history rows return to their
    // natural estimate at the end of this admission pass.
    return pending.has(item.key) ? { ...item, estimatedHeight: 1 } : item;
  };
}

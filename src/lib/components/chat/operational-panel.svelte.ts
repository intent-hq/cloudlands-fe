import { getContext, onDestroy, setContext } from 'svelte';
import { createPanel } from './operational-panel-core';
export type { WindowSegment } from './operational-panel-core';

const CONTEXT = Symbol('operational-panel');

export function provideOperationalPanel(getScrollRoot: () => HTMLElement | undefined) {
  const panel = createPanel(getScrollRoot);
  setContext(CONTEXT, panel);
  onDestroy(() => panel.dispose());
  return panel;
}
export function useOperationalPanel() {
  return (
    getContext<ReturnType<typeof createPanel> | undefined>(CONTEXT) ??
    provideOperationalPanel(() => undefined)
  );
}

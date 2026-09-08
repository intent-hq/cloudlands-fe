export type ToolbarCollapseState = 'full' | 'hostname-hidden' | 'controls-collapsed';

export function toolbarCollapseState(width: number): ToolbarCollapseState {
  if (width < 400) return 'controls-collapsed';
  if (width < 560) return 'hostname-hidden';
  return 'full';
}

export function observeToolbarCollapse(
  node: HTMLElement,
  onChange: (state: ToolbarCollapseState) => void,
) {
  let callback = onChange;
  let lastState: ToolbarCollapseState | undefined;

  const publish = (width: number) => {
    if (width <= 0) return;
    const nextState = toolbarCollapseState(width);
    if (nextState === lastState) return;
    lastState = nextState;
    callback(nextState);
  };

  publish(node.getBoundingClientRect().width);
  const observer =
    typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver(([entry]) => publish(entry?.contentRect.width ?? node.clientWidth));
  observer?.observe(node);

  return {
    update(nextCallback: (state: ToolbarCollapseState) => void) {
      callback = nextCallback;
      if (lastState) callback(lastState);
    },
    destroy() {
      observer?.disconnect();
    },
  };
}

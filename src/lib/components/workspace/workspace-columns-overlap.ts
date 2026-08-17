export interface WorkspaceColumnsOverlapObserver {
  measure: () => void;
  destroy: () => void;
}

export function observeWorkspaceColumnsOverlap(
  scroller: HTMLElement,
  onChange: (overlap: boolean) => void,
): WorkspaceColumnsOverlapObserver {
  let current: boolean | undefined;
  const measure = () => {
    const next = scroller.scrollWidth > scroller.clientWidth && scroller.scrollLeft > 0;
    if (next === current) return;
    current = next;
    onChange(next);
  };

  scroller.addEventListener('scroll', measure, { passive: true });
  const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
  resizeObserver?.observe(scroller);
  if (scroller.firstElementChild) resizeObserver?.observe(scroller.firstElementChild);
  const mutationObserver =
    typeof MutationObserver === 'undefined' ? null : new MutationObserver(measure);
  mutationObserver?.observe(scroller, { childList: true, subtree: true });
  measure();

  return {
    measure,
    destroy: () => {
      scroller.removeEventListener('scroll', measure);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      if (current === true) onChange(false);
      current = false;
    },
  };
}

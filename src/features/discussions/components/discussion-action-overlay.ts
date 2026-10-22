/** Keep below-message actions outside the thread's scroll clip, without changing row geometry. */
export function discussionActionOverlay(node: HTMLElement) {
  const row = node.closest<HTMLElement>('[data-discussion-message]');
  const anchor = node.closest<HTMLElement>('[data-discussion-message-content]');
  const scroller = node.closest<HTMLElement>('[data-discussion-scroll]');
  if (!row || !anchor || !scroller) return;

  node.style.position = 'fixed';
  node.style.right = 'auto';
  function position() {
    if (!anchor || !scroller) return;
    const bounds = anchor.getBoundingClientRect();
    const viewport = scroller.getBoundingClientRect();
    node.style.visibility =
      bounds.bottom < viewport.top || bounds.bottom > viewport.bottom ? 'hidden' : '';
    // A panel with containment/transform can be the fixed-position containing block.
    const parent = node.offsetParent instanceof HTMLElement ? node.offsetParent : null;
    const parentBounds = parent?.getBoundingClientRect();
    const scaleX = parent && parentBounds ? parentBounds.width / parent.offsetWidth : 1;
    const scaleY = parent && parentBounds ? parentBounds.height / parent.offsetHeight : 1;
    node.style.top = `${(bounds.bottom - (parentBounds?.top ?? 0)) / scaleY - (parent?.clientTop ?? 0)}px`;
    node.style.left = `${(bounds.right - (parentBounds?.left ?? 0)) / scaleX - (parent?.clientLeft ?? 0) - node.offsetWidth}px`;
  }
  function updateVisible() {
    if (
      row?.matches(':hover, :focus-within, .actions-open') ||
      window.matchMedia('(hover: none)').matches
    )
      position();
  }
  const observer = new ResizeObserver(updateVisible);
  observer.observe(anchor);
  observer.observe(scroller);
  row.addEventListener('pointerenter', position);
  row.addEventListener('focusin', position);
  window.addEventListener('scroll', updateVisible, true);
  window.addEventListener('resize', updateVisible);
  position();
  return {
    destroy() {
      observer.disconnect();
      row.removeEventListener('pointerenter', position);
      row.removeEventListener('focusin', position);
      window.removeEventListener('scroll', updateVisible, true);
      window.removeEventListener('resize', updateVisible);
    },
  };
}

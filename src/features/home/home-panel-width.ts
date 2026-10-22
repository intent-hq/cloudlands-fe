export function observeHomePanelWidth(node: HTMLElement, onWidth: (width: number) => void) {
  const parent = node.parentElement;
  if (!parent) return;

  const observer = new ResizeObserver(([entry]) => {
    if (entry.contentRect.width <= 0) return;
    const style = getComputedStyle(node);
    const spacing =
      parseFloat(style.marginLeft) +
      parseFloat(style.marginRight) +
      parseFloat(style.paddingLeft) +
      parseFloat(style.paddingRight);
    onWidth(Math.max(320, entry.contentRect.width - spacing));
  });
  observer.observe(parent);
  return { destroy: () => observer.disconnect() };
}

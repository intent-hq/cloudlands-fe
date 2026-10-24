/** Measure button bounds for containment and interaction stability. */
export function probeHeaderIcons(root: Element) {
  return [...root.querySelectorAll<HTMLButtonElement>('button')].map((button) => {
    const target = button.getBoundingClientRect();
    return {
      id: button.dataset.testid!,
      target: { x: target.x, y: target.y, width: target.width, height: target.height },
      opacity: Number(getComputedStyle(button).opacity),
    };
  });
}

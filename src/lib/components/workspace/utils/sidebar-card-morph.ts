const CONTENT_REVEAL_START = 0.72;
const CONTENT_REVEAL_SPAN = 0.28;
const CONTENT_REVEAL_OFFSET_PX = 4;

export function contentRevealProgress(t: number): number {
  return Math.max(0, Math.min(1, (t - CONTENT_REVEAL_START) / CONTENT_REVEAL_SPAN));
}

// Writes only non-inherited properties onto the content node itself; an inherited
// custom property on the card shell would restyle the whole card subtree every frame.
export function applyContentReveal(content: HTMLElement | null, t: number): void {
  if (!content) return;
  const progress = contentRevealProgress(t);
  if (progress >= 1) {
    content.style.removeProperty('opacity');
    content.style.removeProperty('transform');
    content.style.removeProperty('will-change');
    return;
  }
  content.style.opacity = `${progress}`;
  content.style.transform = `translateY(${(1 - progress) * CONTENT_REVEAL_OFFSET_PX}px)`;
  content.style.willChange = 'opacity, transform';
}

/** @internal Test helper for the dock composer component specs. */
import type { Locator } from '@playwright/test';

/** Guard against a visible stop pill hiding a clipped timer or an unusable meter. */
export async function readDictationIndicators(component: Locator) {
  const timer = component.locator('[data-dock-media-footer] [data-dictation-elapsed]');
  return timer.evaluate((element) => {
    const footer = element.closest('[data-dock-media-footer]');
    const pill = element.closest('button');
    const waveform = pill?.querySelector('[data-dictation-waveform]');
    if (!footer || !pill || !waveform) return null;
    const range = document.createRange();
    range.selectNodeContents(element);
    const text = range.getBoundingClientRect();
    const available = pill.getBoundingClientRect();
    const bounds = footer.getBoundingClientRect();
    const meter = waveform.getBoundingClientRect();
    const visibleBars = Array.from(waveform.children).filter((bar) => {
      const box = bar.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && box.left >= meter.left && box.right <= meter.right;
    }).length;
    return {
      timerUnclipped:
        text.width > 0 &&
        text.left >= available.left &&
        text.right <= available.right &&
        text.left >= bounds.left &&
        text.right <= bounds.right,
      separate: text.right <= meter.left,
      meterInsidePill: meter.left >= available.left && meter.right <= available.right,
      allBarsVisible: visibleBars === 5,
    };
  });
}

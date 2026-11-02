import type { Locator } from '@playwright/test';

/** Guard against a visible stop button hiding a clipped timer and unusable meter. */
export async function readDictationIndicators(component: Locator) {
  const timer = component.locator('[data-dock-dictation-time]');
  return timer.evaluate((element) => {
    const footer = element.closest('[data-dock-media-footer]');
    const waveform = footer?.querySelector('[data-dock-dictation-waveform]');
    const gap = element.parentElement;
    if (!footer || !waveform || !gap) return null;
    const range = document.createRange();
    range.selectNodeContents(element);
    const text = range.getBoundingClientRect();
    const available = gap.getBoundingClientRect();
    const bounds = footer.getBoundingClientRect();
    const meter = waveform.getBoundingClientRect();
    const visibleSamples = Array.from(waveform.children).filter((sample) => {
      const bar = sample.getBoundingClientRect();
      return bar.width > 0 && bar.height > 0 && bar.left >= meter.left && bar.right <= meter.right;
    }).length;
    return {
      timerUnclipped:
        text.width > 0 &&
        text.left >= available.left &&
        text.right <= available.right &&
        text.left >= bounds.left &&
        text.right <= bounds.right,
      separate: meter.right <= text.left,
      usefulHistory: visibleSamples >= 2,
    };
  });
}

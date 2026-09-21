import { expect } from '@playwright/experimental-ct-svelte';
import type { Locator } from '@playwright/test';

/** The outer edit decoration owns the boundary; the focused control must not paint another. */
export async function expectUnpaintedEditControl(control: Locator) {
  await expect(control).toBeFocused();
  await control.hover();
  for (const side of ['top', 'right', 'bottom', 'left']) {
    await expect(control).toHaveCSS(`border-${side}-width`, '0px');
  }
  await expect(control).toHaveCSS('outline-style', 'none');
  await expect(control).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect
    .poll(() =>
      control.evaluate((node) => {
        const shadow = getComputedStyle(node).boxShadow;
        return (
          shadow === 'none' ||
          (shadow.match(/-?[\d.]+px/g) ?? []).every((length) => Number.parseFloat(length) === 0)
        );
      }),
    )
    .toBe(true);
}

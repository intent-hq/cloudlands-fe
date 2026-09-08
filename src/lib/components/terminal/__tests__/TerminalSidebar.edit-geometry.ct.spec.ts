import { expect, test } from '@playwright/experimental-ct-svelte';
import TerminalSidebarEditGeometryHost from './mocks/TerminalSidebarEditGeometryHost.svelte';

function isTransparent(color: string) {
  const normalized = color.replace(/\s+/g, '').toLowerCase();
  return (
    normalized === 'transparent' ||
    /rgba\([^)]*,0(?:\.0+)?\)$/.test(normalized) ||
    /color\([^)]*\/0(?:\.0+)?\)$/.test(normalized)
  );
}

test('keeps script rename decoration visible, padded, unclipped, and motion-safe', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(TerminalSidebarEditGeometryHost);
  const decoration = component.locator('[data-script-rename-decoration="script-geometry"]');
  expect(
    isTransparent(await decoration.evaluate((node) => getComputedStyle(node).borderTopColor)),
  ).toBe(true);

  await component.getByText('build geometry', { exact: true }).dblclick();
  const input = component.locator('[data-edit-script="script-geometry"]');
  await expect(input).toBeFocused();
  const result = await input.evaluate((node) => {
    const decoration = node.parentElement!.querySelector<HTMLElement>(
      '[data-script-rename-decoration="script-geometry"]',
    )!;
    const inputRect = node.getBoundingClientRect();
    const decorationRect = decoration.getBoundingClientRect();
    const style = getComputedStyle(decoration);
    let overflowAncestor = decoration.parentElement?.parentElement ?? null;
    while (overflowAncestor) {
      const ancestorStyle = getComputedStyle(overflowAncestor);
      if (ancestorStyle.overflowX !== 'visible' || ancestorStyle.overflowY !== 'visible') break;
      overflowAncestor = overflowAncestor.parentElement;
    }
    const ancestorRect = overflowAncestor?.getBoundingClientRect();
    const clientRect =
      overflowAncestor && ancestorRect
        ? {
            left: ancestorRect.left + overflowAncestor.clientLeft,
            top: ancestorRect.top + overflowAncestor.clientTop,
            right: ancestorRect.left + overflowAncestor.clientLeft + overflowAncestor.clientWidth,
            bottom: ancestorRect.top + overflowAncestor.clientTop + overflowAncestor.clientHeight,
          }
        : null;
    return {
      margins: {
        left: inputRect.left - decorationRect.left,
        right: decorationRect.right - inputRect.right,
        top: inputRect.top - decorationRect.top,
        bottom: decorationRect.bottom - inputRect.bottom,
      },
      borderColor: style.borderTopColor,
      transitionDurations: style.transitionDuration.split(',').map((value) => value.trim()),
      hasOverflowAncestor: clientRect !== null,
      clipped:
        clientRect === null ||
        decorationRect.left < clientRect.left - 0.5 ||
        decorationRect.right > clientRect.right + 0.5 ||
        decorationRect.top < clientRect.top - 0.5 ||
        decorationRect.bottom > clientRect.bottom + 0.5,
    };
  });

  expect(result.margins.left).toBeGreaterThanOrEqual(4);
  expect(result.margins.right).toBeGreaterThanOrEqual(4);
  expect(result.margins.top).toBeGreaterThanOrEqual(2);
  expect(result.margins.bottom).toBeGreaterThanOrEqual(2);
  expect(isTransparent(result.borderColor)).toBe(false);
  expect(result.transitionDurations.every((duration) => duration === '0s')).toBe(true);
  expect(result.hasOverflowAncestor).toBe(true);
  expect(result.clipped).toBe(false);
});

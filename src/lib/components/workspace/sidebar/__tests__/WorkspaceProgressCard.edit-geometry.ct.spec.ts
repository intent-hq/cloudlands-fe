import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Locator } from '@playwright/test';
import WorkspaceProgressCardEditGeometryHost from './mocks/WorkspaceProgressCardEditGeometryHost.svelte';

function isTransparent(color: string) {
  const normalized = color.replace(/\s+/g, '').toLowerCase();
  return (
    normalized === 'transparent' ||
    /rgba\([^)]*,0(?:\.0+)?\)$/.test(normalized) ||
    /color\([^)]*\/0(?:\.0+)?\)$/.test(normalized)
  );
}

async function inspectEditBox(control: Locator) {
  return control.evaluate((node) => {
    const decoration = node.parentElement!.querySelector<HTMLElement>(
      ':scope > [aria-hidden="true"]',
    )!;
    const controlRect = node.getBoundingClientRect();
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
        left: controlRect.left - decorationRect.left,
        right: decorationRect.right - controlRect.right,
        top: controlRect.top - decorationRect.top,
        bottom: decorationRect.bottom - controlRect.bottom,
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
}

async function expectValidEditBox(control: Locator) {
  const result = await inspectEditBox(control);
  expect(result.margins.left).toBeGreaterThanOrEqual(4);
  expect(result.margins.right).toBeGreaterThanOrEqual(4);
  expect(result.margins.top).toBeGreaterThanOrEqual(2);
  expect(result.margins.bottom).toBeGreaterThanOrEqual(2);
  expect(isTransparent(result.borderColor)).toBe(false);
  expect(result.transitionDurations.every((duration) => duration === '0s')).toBe(true);
  expect(result.hasOverflowAncestor).toBe(true);
  expect(result.clipped).toBe(false);
}

test('keeps the workspace title edit decoration visible, padded, unclipped, and motion-safe', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(WorkspaceProgressCardEditGeometryHost);
  const idleDecoration = component.locator('[data-workspace-title-edit-decoration]');
  expect(
    isTransparent(await idleDecoration.evaluate((node) => getComputedStyle(node).borderTopColor)),
  ).toBe(true);

  await component.getByRole('button', { name: 'Geometry workspace' }).click();
  const input = component.getByRole('textbox');
  await expect(input).toBeFocused();
  await expectValidEditBox(input);
});

test('keeps the workspace status edit decoration visible, padded, unclipped, and motion-safe', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(WorkspaceProgressCardEditGeometryHost);
  const idleDecoration = component.locator('[data-workspace-status-edit-decoration]');
  expect(
    isTransparent(await idleDecoration.evaluate((node) => getComputedStyle(node).borderTopColor)),
  ).toBe(true);

  await component.getByRole('button', { name: 'Edit workspace status' }).click();
  const input = component.getByRole('textbox', { name: 'Workspace status' });
  await expect(input).toBeFocused();
  await expectValidEditBox(input);
});

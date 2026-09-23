import type { Page } from '@playwright/experimental-ct-svelte';
import { expect, test } from '../../../test/ct-test';
import WorkspaceRepoLauncher from './WorkspaceRepoLauncher.svelte';

/**
 * The title-bar launcher keeps keyboard focus contained inside its 32px
 * target: no outline or ring grows past the button, the border and background
 * carry the focus treatment instead, and under forced colors the border
 * resolves to the system button text color so the focus stays visible.
 * Component styles only resolve in a real browser; the jsdom suite covers the
 * label, tooltip, and activation.
 */

async function systemColor(page: Page, value: string) {
  return page.evaluate((propertyValue) => {
    const node = document.createElement('span');
    node.style.color = propertyValue;
    document.body.append(node);
    const resolved = getComputedStyle(node).color;
    node.remove();
    return resolved;
  }, value);
}

async function tokenColor(page: Page, className: string) {
  return page.evaluate((probeClass) => {
    const node = document.createElement('span');
    node.className = probeClass;
    document.body.append(node);
    const resolved = getComputedStyle(node).backgroundColor;
    node.remove();
    return resolved;
  }, className);
}

test('contains keyboard focus with a foreground border and muted fill instead of an outline', async ({
  mount,
  page,
}) => {
  const component = await mount(WorkspaceRepoLauncher);
  const button = component.getByRole('button', { name: 'New Workspace' });

  await page.keyboard.press('Tab');
  await expect(button).toBeFocused();
  expect(await button.evaluate((node) => node.matches(':focus-visible'))).toBe(true);

  await expect(button).toHaveCSS('outline-width', '0px');
  await expect(button).toHaveCSS('outline-offset', '0px');
  const [borderColor, textColor] = await button.evaluate((node) => {
    const style = getComputedStyle(node);
    return [style.borderTopColor, style.color];
  });
  expect(borderColor).toBe(textColor);
  await expect(button).toHaveCSS('background-color', await tokenColor(page, 'bg-muted'));
  // No focus ring or shadow extends the target: every computed shadow layer is
  // zero-sized (`rgb(...) 0px 0px 0px 0px`) or there is none at all.
  const boxShadow = await button.evaluate((node) => getComputedStyle(node).boxShadow);
  const shadowLayers = boxShadow === 'none' ? [] : boxShadow.split(/,(?![^(]*\))/);
  for (const layer of shadowLayers) {
    expect(layer.trim(), boxShadow).toMatch(/(^|\)) 0px 0px 0px 0px( inset)?$/);
  }
});

test('keeps the focus border visible under forced colors', async ({ mount, page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  const component = await mount(WorkspaceRepoLauncher);
  const button = component.getByRole('button', { name: 'New Workspace' });

  await page.keyboard.press('Tab');
  await expect(button).toBeFocused();

  await expect(button).toHaveCSS('border-top-color', await systemColor(page, 'ButtonText'));
  await expect(button).toHaveCSS('outline-width', '0px');
});

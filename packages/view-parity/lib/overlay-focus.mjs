import { test as base, expect, openExample } from './functional.mjs';

export { expect };

export const test = base.extend({
  overlayBrowser: [
    async ({ browser }, use, testInfo) => {
      const version = browser.version();
      await testInfo.attach('overlay-browser.json', {
        body: JSON.stringify({ version, expected: '153.0.8010.12' }),
        contentType: 'application/json',
      });
      expect(version, 'Use the pinned Chromium supplied by Playwright 1.63.0').toBe(
        '153.0.8010.12',
      );
      await use();
    },
    { auto: true },
  ],
});

export async function openMenu(page, { forceMount = false, trigger = true } = {}) {
  const example = await openExample(page, 'menu', 'menu-focus');
  if (forceMount)
    await example.getByRole('switch', { name: 'Force mount menu content', exact: true }).check();
  if (!trigger)
    await example.getByRole('switch', { name: 'Use menu trigger', exact: true }).uncheck();
  await example.getByRole('button', { name: 'Mount static menu', exact: true }).click();
  const menu = example.getByRole('menu', { name: 'Static focus menu', exact: true });
  await expect(menu).toBeVisible();
  await expect(example.getByLabel('Static menu open', { exact: true })).toHaveText('true');
  await expect
    .poll(() => menu.evaluate((node) => node.contains(node.ownerDocument.activeElement)))
    .toBe(true);
  return { example, menu, outside: example.getByRole('textbox', { name: 'Outside field' }) };
}

// Public HTMLElement.focus() is the actual regression: observe its synchronous
// result, before any Playwright assertion can poll away an escaped-focus interval.
// The caller first reaches the expected owner through native keyboard/pointer input.
export async function expectSynchronousReclaim(outside, owner) {
  await expect(owner).toBeFocused();
  const result = await outside.evaluate((node) => {
    const previous = node.ownerDocument.activeElement;
    node.focus();
    return {
      reclaimed: node.ownerDocument.activeElement === previous,
      escaped: node.ownerDocument.activeElement === node,
    };
  });
  expect(result).toEqual({ reclaimed: true, escaped: false });
  await expect(owner).toBeFocused();
}

export async function expectOutsideReleased(example, outside) {
  expect(
    await outside.evaluate((node) => {
      node.focus();
      return node.ownerDocument.activeElement === node;
    }),
    'Closing or removing the menu must release programmatic focus capture',
  ).toBe(true);
  await outside.press('ControlOrMeta+a');
  await outside.pressSequentially('outside input');
  await expect(outside).toHaveValue('outside input');
  const action = example.getByRole('button', { name: 'Outside action', exact: true });
  const count = example.getByLabel('Outside action count', { exact: true });
  const before = Number(await count.textContent());
  await action.click();
  await expect(count).toHaveText(String(before + 1));
}

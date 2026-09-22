import { expect, test } from '../../../../test/ct-test';
import Harness from './mocks/NotePanelMenuHarness.svelte';

test('production note actions keep rounded surfaces and keyboard state across both entry points', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 420, height: 640 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as typeof window & { copiedNote?: string }).copiedNote = text;
        },
      },
    });
  });
  const component = await mount(Harness, {
    hooksConfig: { mockIpc: { 'workspace:get-root': null } },
  });
  const header = component.locator('[data-panel-tabless-header]');
  const trigger = header.getByTestId('panel-actions-trigger');
  const root = page.locator('[data-slot="menu-content"]');
  const fontTrigger = root.getByRole('menuitem', { name: /Font style/i });
  const fontMenu = page.getByRole('menu', { name: /^Font style$/i });
  const surfaces = [];

  for (const entry of ['overflow', 'context'] as const) {
    await trigger.focus();
    if (entry === 'overflow') {
      await page.keyboard.press('Enter');
    } else {
      await header.dispatchEvent('contextmenu', {
        bubbles: true,
        clientX: 30,
        clientY: 20,
      });
    }
    await expect(root).toBeVisible();
    await expect(fontTrigger).toBeVisible();
    await root.evaluate(async (node) => {
      await document.fonts.ready;
      await Promise.allSettled(node.getAnimations({ subtree: true }).map((a) => a.finished));
    });
    const surface = await root.evaluate((node) => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return {
        radius: style.borderRadius,
        border: style.border,
        padding: style.padding,
        background: style.backgroundColor,
        contained: rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
        portalled: !document.querySelector('[data-testid="note-menu-host"]')!.contains(node),
      };
    });
    expect(parseFloat(surface.radius)).toBeGreaterThan(0);
    expect(surface).toMatchObject({ contained: true, portalled: true });
    surfaces.push(surface);
    await testInfo.attach(`note-${entry}-root`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    await fontTrigger.focus();
    await page.keyboard.press('ArrowRight');
    await expect(fontMenu).toBeVisible();
    const serif = fontMenu.getByRole('menuitemradio', { name: 'Serif', exact: true });
    await serif.focus();
    await page.keyboard.press('Enter');
    await expect(serif).toHaveAttribute('aria-checked', 'true');
    await expect(root).toBeVisible();
    expect(await fontMenu.evaluate((node) => getComputedStyle(node).borderRadius)).toBe(
      surface.radius,
    );
    await testInfo.attach(`note-${entry}-font-submenu`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await page.keyboard.press('Escape');
    await expect(fontMenu).toBeHidden();
    await expect(fontTrigger).toBeFocused();
    await expect(root).toBeVisible();
    const spellcheck = root.getByRole('menuitemcheckbox', { name: 'Spellcheck', exact: true });
    const previous = await spellcheck.getAttribute('aria-checked');
    await spellcheck.focus();
    await page.keyboard.press('Space');
    await expect(spellcheck).toHaveAttribute(
      'aria-checked',
      previous === 'true' ? 'false' : 'true',
    );
    await expect(root).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(root).toBeHidden();
    await expect(trigger).toBeFocused();
  }
  expect(surfaces[1]).toEqual(surfaces[0]);
  await testInfo.attach('note-entry-surface-parity', {
    body: JSON.stringify(surfaces),
    contentType: 'application/json',
  });
  await trigger.click();
  const copy = root.getByRole('menuitem', { name: /Copy full note/i });
  await copy.focus();
  await page.keyboard.press('Enter');
  await expect(root).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect
    .poll(() => page.evaluate(() => (window as typeof window & { copiedNote?: string }).copiedNote))
    .toBe('# Menu acceptance\n\nCopy the complete note.');
});

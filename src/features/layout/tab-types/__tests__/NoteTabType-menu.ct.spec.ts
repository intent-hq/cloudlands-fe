import { expect, test } from '../../../../test/ct-test';
import Harness from './mocks/NotePanelMenuHarness.svelte';

test('production note actions preserve selection and keyboard state across both entry points', async ({
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
          (window as typeof window & { fallbackCopy?: string }).fallbackCopy = text;
        },
      },
    });
  });
  const previousBridge = await page.evaluateHandle(() => window.electronAPI);
  const previousElectronVersion = await page.evaluate(() => window.electronAPI?.versions.electron);
  const component = await mount(Harness, {
    hooksConfig: { mockIpc: { 'workspace:get-root': null } },
  });
  const wire = () =>
    component
      .getByTestId('note-menu-wire')
      .textContent()
      .then((text) => JSON.parse(text!));
  await expect.poll(wire).toMatchObject({
    status: 'ready',
    commits: 0,
    stagedText: '',
    committedText: null,
    window: {
      tabId: 'note-menu-tab',
      loading: false,
      scope: {
        backendId: 'note-menu-ct',
        workspaceId: 'note-panel-menu-ct',
        noteId: 'menu-note',
        noteInstanceId: 'i',
      },
      sourceRevision: 'r4',
      snapshotId: 's4',
      range: { start: 0, end: '# Menu acceptance\n\nCopy the complete note.'.length },
      text: '# Menu acceptance\n\nCopy the complete note.',
    },
  });
  const reader = component.locator('.tiptap[contenteditable="false"]');
  await expect(reader).toBeVisible();
  await expect(reader).toHaveText('# Menu acceptance\n\nCopy the complete note.');
  const header = component.locator('[data-panel-tabless-header]');
  const trigger = header.getByTestId('panel-actions-trigger');
  const root = page.locator('[data-slot="menu-content"]');
  const fontTrigger = root.getByRole('menuitem', { name: /^Font\b/i });
  const fontMenu = page.getByRole('menu', { name: /^Font$/i });

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
    // The programmatic context entry opens before floating placement has settled.
    // Poll the same viewport bounds so persistent clipping still fails.
    const readSurface = () =>
      root.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return {
          contained:
            rect.left >= 0 &&
            rect.top >= 0 &&
            rect.right <= innerWidth &&
            rect.bottom <= innerHeight,
          portalled: !document.querySelector('[data-testid="note-menu-host"]')!.contains(node),
          bounds: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
          viewport: { width: innerWidth, height: innerHeight },
        };
      });
    await expect.poll(readSurface).toMatchObject({ contained: true, portalled: true });
    await testInfo.attach(`note-${entry}-bounds`, {
      body: JSON.stringify(await readSurface()),
      contentType: 'application/json',
    });
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
  await trigger.click();
  const viewTrigger = root.getByRole('menuitem', { name: /^Note view/ });
  await viewTrigger.focus();
  await page.keyboard.press('ArrowRight');
  const viewMenu = page.getByRole('menu', { name: 'Note view', exact: true });
  const preview = viewMenu.getByRole('menuitemradio', { name: 'Rendered preview', exact: true });
  await preview.click();
  await expect(preview).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  const spellcheck = root.getByRole('menuitemcheckbox', { name: 'Spellcheck', exact: true });
  await expect(spellcheck).toHaveAttribute('aria-disabled', 'true');
  await testInfo.attach('note-disabled-description', {
    body: await root.screenshot(),
    contentType: 'image/png',
  });
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await trigger.click();
  const copy = root.getByRole('menuitem', { name: /Copy full note/i });
  await copy.focus();
  await page.keyboard.press('Enter');
  await expect(root).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect.poll(wire).toMatchObject({
    status: 'ready',
    committedText: '# Menu acceptance\n\nCopy the complete note.',
    commits: 1,
    stagedText: '',
  });
  expect(
    await page.evaluate(() => (window as typeof window & { fallbackCopy?: string }).fallbackCopy),
  ).toBeUndefined();
  await component.unmount();
  expect(await page.evaluate((previous) => window.electronAPI === previous, previousBridge)).toBe(
    true,
  );
  expect(await page.evaluate(() => window.electronAPI?.versions.electron)).toBe(
    previousElectronVersion,
  );
  await previousBridge.dispose();
});

import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Locator } from '@playwright/test';
import EmbeddedPreview from './embedded-browser.preview.svelte';
import ViewerPreview from './browser-viewer-tab.preview.svelte';

const url = 'https://example.invalid/docs';
const mirror = { url, title: 'Example docs', host: { name: 'fixture-host', connected: true } };
const addressName = 'Edit browser address';

async function geometry(node: Locator) {
  return node.evaluate((element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return { x, y, width, height, radius: style.borderRadius };
  });
}

for (const kind of ['embedded', 'viewer'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`${kind} address hover covers exactly its resting surface in ${theme}`, async ({
      mount,
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.evaluate(
        (dark) => document.documentElement.classList.toggle('dark', dark),
        theme === 'dark',
      );
      if (kind === 'embedded') {
        await mount(EmbeddedPreview);
        await expect(page.locator('[data-embedded-browser-fixture]')).toHaveAttribute(
          'data-embedded-browser-fixture',
          'true',
        );
      } else await mount(ViewerPreview, { props: { mirror, width: 640 } });

      const outer = page.locator('[data-browser-address-surface]');
      const trigger = page.getByRole('button', { name: addressName });
      const rest = await geometry(outer);
      const label = trigger.locator('[data-slot="button-label"]');
      const labelRest = await geometry(label);
      const restPaint = await trigger.evaluate((node) => getComputedStyle(node).backgroundColor);
      expect(await geometry(trigger)).toEqual(rest);

      // The old padding gutters were outside the hit target as well as outside the hover paint.
      await trigger.hover({ position: { x: 2, y: rest.height / 2 } });
      await expect
        .poll(() => trigger.evaluate((node) => getComputedStyle(node).backgroundColor))
        .not.toBe(restPaint);
      expect(await geometry(trigger)).toEqual(rest);
      expect(await geometry(label)).toEqual(labelRest);
      // No second ghost fill/shadow may paint a different rectangle behind the content.
      await expect(trigger.locator('[data-slot="button-surface"]')).toHaveCSS(
        'background-color',
        'rgba(0, 0, 0, 0)',
      );
      await trigger.click({ position: { x: rest.width - 2, y: rest.height / 2 } });
      const editor = page.getByRole('textbox');
      await expect(editor).toBeFocused();
      const edit = await geometry(editor);
      expect(edit.x).toBeCloseTo(rest.x + 8);
      expect(edit.width).toBeGreaterThan(0);
      expect(edit.x + edit.width).toBeLessThanOrEqual(rest.x + rest.width - 8);
    });
  }

  test(`${kind} address keeps keyboard editing, cancellation and navigation`, async ({
    mount,
    page,
  }) => {
    if (kind === 'embedded') {
      await mount(EmbeddedPreview);
      await expect(page.locator('[data-embedded-browser-fixture]')).toHaveAttribute(
        'data-embedded-browser-fixture',
        'true',
      );
    } else await mount(ViewerPreview, { props: { mirror, width: 640 } });
    const trigger = page.getByRole('button', { name: addressName });
    const identity = await trigger.textContent();
    for (let index = 0; index < 12; index += 1) {
      await page.keyboard.press('Tab');
      if (await trigger.evaluate((node) => node === document.activeElement)) break;
    }
    await expect(trigger).toBeFocused();
    expect(await trigger.evaluate((node) => getComputedStyle(node).boxShadow)).not.toBe('none');
    await page.keyboard.press('Enter');
    const editor = page.getByRole('textbox');
    await expect(editor).toBeFocused();
    await expect(editor).toHaveValue(url);
    expect(
      await editor.evaluate((node: HTMLInputElement) => node.selectionEnd! - node.selectionStart!),
    ).toBe(url.length);
    await editor.fill('https://example.invalid/cancelled');
    await page.keyboard.press('Escape');
    await expect(editor).toHaveCount(0);
    await expect(trigger).toHaveText(identity!);
    await expect(page.locator('[data-preview-last-action]')).toHaveCount(0);
    await trigger.click();
    await expect(editor).toHaveValue(url);
    await editor.fill('https://example.invalid/next');
    await page.keyboard.press('Enter');
    await expect(editor).toHaveCount(0);
    await expect(page.locator('[data-preview-last-action]')).toHaveAttribute(
      'data-preview-last-action',
      'navigate https://example.invalid/next',
    );
    if (kind === 'embedded')
      await expect(page.locator('webview')).toHaveAttribute('src', 'about:blank');
  });
}

test('offline viewer does not hover or edit and keeps navigation disabled', async ({
  mount,
  page,
}) => {
  await mount(ViewerPreview, {
    props: { mirror: { ...mirror, host: { ...mirror.host, connected: false } }, width: 640 },
  });
  const trigger = page.getByRole('button', { name: addressName });
  await expect(trigger).toBeDisabled();
  const rest = await trigger.evaluate((node) => getComputedStyle(node).backgroundColor);
  const box = await trigger.boundingBox();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(trigger).toHaveCSS('background-color', rest);
  await expect(page.getByRole('textbox')).toHaveCount(0);
  for (const name of ['Go back', 'Go forward', 'Refresh page']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
  }
});

test('loading embedded browser keeps address editing and disables refresh', async ({
  mount,
  page,
}) => {
  await mount(EmbeddedPreview, { props: { loading: true } });
  await expect(page.locator('[data-embedded-browser-fixture]')).toHaveAttribute(
    'data-embedded-browser-fixture',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Refresh page', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: addressName }).click();
  await expect(page.getByRole('textbox')).toBeFocused();
  await expect(page.getByRole('textbox')).toHaveValue(url);
});

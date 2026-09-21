import type { Locator } from '@playwright/experimental-ct-svelte';
import { expect, test } from '../../../../test/ct-test';
import SetupScriptModalPreview from '../setup-script-modal.preview.svelte';

/**
 * Focus the editor only after the dialog's open auto-focus has landed. bits-ui's
 * focus scope moves focus to the first tabbable in a requestAnimationFrame after
 * Dialog.Content mounts; under CI load that frame can run after Monaco is already
 * visible, so focusing the editor earlier lets the deferred auto-focus steal it back.
 */
async function focusEditor(dialog: Locator): Promise<Locator> {
  await expect
    .poll(() => dialog.evaluate((node) => node.contains(document.activeElement)))
    .toBe(true);
  const input = dialog.getByRole('textbox', { name: 'Editor content' });
  await input.focus();
  await expect(input).toBeFocused();
  return input;
}

for (const width of [420, 1100]) {
  test(`keeps the script editor and source rows contained at ${width}px`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    await mount(SetupScriptModalPreview);
    const dialog = page.getByRole('dialog');
    const editor = dialog.locator('.monaco-editor').first();
    await expect(editor).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await testInfo.attach('modal', { body: await page.screenshot(), contentType: 'image/png' });
    const geometry = await dialog.evaluate((node) => {
      const bounds = node.getBoundingClientRect();
      const editorBounds = node.querySelector('.monaco-editor')!.getBoundingClientRect();
      const variables = Array.from(node.querySelectorAll('button'))
        .find((button) => button.textContent?.trim() === '$MAIN_CHECKOUT')!
        .getBoundingClientRect();
      return {
        viewport: window.innerWidth,
        left: bounds.left,
        right: bounds.right,
        width: node.clientWidth,
        scrollWidth: node.scrollWidth,
        editorLeft: editorBounds.left,
        editorRight: editorBounds.right,
        editorWidth: editorBounds.width,
        editorHeight: editorBounds.height,
        variablesBottom: variables.bottom,
        editorTop: editorBounds.top,
      };
    });
    await testInfo.attach('geometry', {
      body: JSON.stringify(geometry),
      contentType: 'application/json',
    });
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1);
    expect(geometry.editorLeft).toBeGreaterThanOrEqual(geometry.left);
    expect(geometry.editorRight).toBeLessThanOrEqual(geometry.right);
    expect(geometry.editorWidth).toBeGreaterThan(200);
    expect(geometry.editorHeight).toBeGreaterThan(180);
    expect(geometry.variablesBottom).toBeLessThan(geometry.editorTop);
    await expect(dialog.getByRole('button', { name: 'Clear', exact: true })).toHaveCount(0);
    const template = dialog.getByRole('button', { name: /Node.js \(pnpm\)/ });
    const row = await template.evaluate((node) => {
      const title = Array.from(node.querySelectorAll('span')).find(
        (el) => el.textContent === 'Node.js (pnpm)',
      )!;
      const description = node.querySelector('p')!;
      return {
        title: title.getBoundingClientRect().toJSON(),
        description: description.getBoundingClientRect().toJSON(),
        row: node.getBoundingClientRect().toJSON(),
      };
    });
    expect(row.description.top).toBeGreaterThanOrEqual(row.title.bottom);
    expect(row.description.left).toBeCloseTo(row.title.left, 0);
    expect(row.description.bottom).toBeLessThanOrEqual(row.row.bottom);
    await template.click();
    await expect(template).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.getByRole('button', { name: /From repo config/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(dialog.getByRole('textbox', { name: 'Editor content' })).toBeFocused();
    // Monaco virtualizes lines below the viewport. Verify the selected script
    // through the real Done action rather than treating .view-lines as the model.
    await dialog.getByRole('button', { name: /Done/ }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('saved-script')).toContainText('pnpm install');
    await page.getByRole('button', { name: 'Open setup script' }).click();
    await expect(dialog.getByRole('textbox', { name: 'Editor content' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).press('Escape');
    await expect(dialog).toHaveCount(0);
  });
}

test('keeps editor and footer usable in a short compact window', async ({ mount, page }) => {
  await page.setViewportSize({ width: 420, height: 600 });
  await mount(SetupScriptModalPreview);
  const dialog = page.getByRole('dialog');
  const input = dialog.getByRole('textbox', { name: 'Editor content' });
  await expect(input).toBeVisible();
  const editor = (await dialog.locator('.monaco-editor').boundingBox())!;
  const done = dialog.getByRole('button', { name: /Done/ });
  const footer = (await done.boundingBox())!;
  expect(editor.height).toBeGreaterThanOrEqual(100);
  expect(footer.y + footer.height).toBeLessThanOrEqual(600);
  await focusEditor(dialog);
  await page.keyboard.type('# edited ');
  await done.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('saved-script')).toContainText('# edited ');
});

test('keeps editor Escape local, discards cancelled edits, and applies Done', async ({
  mount,
  page,
}) => {
  await mount(SetupScriptModalPreview);
  const saved = page.getByTestId('saved-script');
  const initial = await saved.textContent();
  // Monaco resolves its platform from the browser UA, not the Playwright host OS.
  const selectAll = await page.evaluate(() =>
    navigator.userAgent.includes('Macintosh') ? 'Meta+A' : 'Control+A',
  );
  let dialog = page.getByRole('dialog');
  await expect(dialog.locator('.monaco-editor')).toBeVisible();
  const input = await focusEditor(dialog);
  await input.press(selectAll);
  await page.keyboard.type('echo fixture-edited');
  await input.press('Escape');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(saved).toHaveText(initial!);
  await page.getByRole('button', { name: 'Open setup script' }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.locator('.monaco-editor')).toBeVisible();
  await focusEditor(dialog);
  await page.keyboard.press(selectAll);
  await page.keyboard.type('echo fixture-saved');
  await dialog.getByRole('button', { name: /Save.*Done/i }).click();
  await expect(dialog).toHaveCount(0);
  await expect(saved).toHaveText('echo fixture-saved');
});

test('replaces generator status with an adjacent result and applies the safe draft', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await mount(SetupScriptModalPreview, { props: { generator: true } });
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Auto-generate from repo' }).click();
  await expect(dialog.getByText('node setup', { exact: true })).toBeVisible();
  await expect(page.getByTestId('generation-calls')).toHaveText('1');
  const gap = await dialog.getByText('Setup Script Generator', { exact: true }).evaluate((node) => {
    const header = node.parentElement!.parentElement!;
    const result = header.parentElement!.lastElementChild!;
    return result.getBoundingClientRect().top - header.getBoundingClientRect().bottom;
  });
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThanOrEqual(1);
  await dialog.getByRole('button', { name: 'Create Script', exact: true }).press('Enter');
  await expect(dialog.getByText('Setup Script Generator', { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('textbox', { name: 'Editor content' })).toBeFocused();
  await dialog.getByRole('button', { name: /Done/ }).click();
  await expect(page.getByTestId('saved-script')).toContainText('printf "fixture draft');
});

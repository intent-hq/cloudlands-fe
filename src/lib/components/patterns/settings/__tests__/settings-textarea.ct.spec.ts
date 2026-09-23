import { expect, test } from '../../../../../test/ct-test';
import Preview from '../settings-textarea.preview.svelte';

for (const theme of ['light', 'dark'] as const) {
  const background = theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(26, 26, 26)';

  test(`settings textarea preserves its ${theme} surface through native control states`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(
      (dark) => document.documentElement.classList.toggle('dark', dark),
      theme === 'dark',
    );
    const root = await mount(Preview);
    const editable = root.getByRole('textbox', { name: 'Editable setting' });
    const empty = root.getByRole('textbox', { name: 'Empty setting' });
    const readonly = root.getByRole('textbox', { name: 'Read-only setting' });
    const disabled = root.getByRole('textbox', { name: 'Disabled setting' });
    const ordinary = root.getByRole('textbox', { name: 'Ordinary textarea' });
    for (const control of [editable, empty, readonly, disabled]) {
      await expect(control).toHaveCSS('background-color', background);
      await expect(control).toHaveCSS('border-width', '1px');
    }
    await expect(ordinary).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    const restingShadow = await editable.evaluate((e) => getComputedStyle(e).boxShadow);
    await editable.hover();
    await expect(editable).toHaveCSS('background-color', background);
    const focusButton = root.getByRole('button', { name: 'Focus setting', exact: true });
    await focusButton.focus();
    await focusButton.press('Enter');
    await expect(editable).toBeFocused();
    await expect(editable).toHaveCSS('background-color', background);
    // Caret-bearing entries keep their surface without an outer focus box.
    await expect(editable).toHaveCSS('outline-style', 'none');
    await expect(editable).toHaveCSS('box-shadow', restingShadow);
    const textColor = await editable.evaluate((e) => getComputedStyle(e).color);
    await expect(editable).toHaveCSS('caret-color', textColor);
    await editable.fill('Updated settings');
    await expect(root.getByTestId('textarea-events')).toHaveText('Updated settings');
    await expect(root.getByTestId('textarea-events')).toHaveAttribute(
      'data-native-ref',
      'TEXTAREA',
    );
    await root.getByRole('button', { name: 'Blur setting', exact: true }).click();
    await expect(editable).not.toBeFocused();
    await expect(editable).toHaveCSS('background-color', background);
    await readonly.press('End');
    await readonly.pressSequentially('Changed');
    await expect(readonly).toHaveValue('Managed by your organization');
    await expect(readonly).toHaveCSS('background-color', background);
    await expect(disabled).toBeDisabled();
    await disabled.hover();
    await expect(disabled).toHaveCSS('background-color', background);
    expect(
      await disabled.evaluate((element) => Number(getComputedStyle(element).opacity)),
    ).toBeLessThan(1);
  });

  test(`settings consumers retain their ${theme} surface while editing and saving`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(
      (dark) => document.documentElement.classList.toggle('dark', dark),
      theme === 'dark',
    );
    const root = await mount(Preview, { props: { state: 'consumers' } });
    const autosave = root.getByTestId('autosave-setting').getByRole('textbox');
    const json = root.getByTestId('json-import-setting').getByRole('textbox');
    await expect(autosave).toHaveCSS('background-color', background);
    await expect(json).toHaveCSS('background-color', background);
    await autosave.fill('  Updated prompt  ');
    await expect(autosave).toHaveCSS('background-color', background);
    await autosave.press('Control+s');
    await expect(root.getByTestId('saved-setting')).toHaveText('Updated prompt');
    const value = '{"fixture":{"command":"echo","args":["fixture"]}}';
    await json.fill(value);
    await expect(json).toHaveCSS('background-color', background);
    await json.press('Control+Enter');
    await expect(root.getByTestId('imported-setting')).toHaveText(value);
    await expect(autosave).toHaveCSS('background-color', background);
  });
}

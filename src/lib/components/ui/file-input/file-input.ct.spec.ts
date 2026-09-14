import { test, expect } from '@playwright/experimental-ct-svelte';
import FileInput from './file-input.svelte';

for (const theme of ['light', 'dark'] as const) {
  test(`keeps invalid file trigger neutral in ${theme}`, async ({ mount, page }) => {
    await page.evaluate(
      (dark) => document.documentElement.classList.toggle('dark', dark),
      theme === 'dark',
    );
    await mount(FileInput, {
      props: {
        id: 'invalid-file',
        label: 'Choose file',
        invalid: true,
        error: 'Choose a supported file.',
      },
    });
    const button = page.getByRole('button', { name: 'Choose file' });
    await expect(button).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('alert')).toBeVisible();
    const shadow = await button.evaluate((node) =>
      getComputedStyle(node).getPropertyValue('--tw-ring-shadow'),
    );
    expect(shadow).toMatch(/0px/);
  });
}

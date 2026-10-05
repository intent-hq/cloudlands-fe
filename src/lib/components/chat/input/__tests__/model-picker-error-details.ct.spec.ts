import { expect, test } from '../../../../../test/ct-test';
import ModelPickerGeometryHost from './ModelPickerGeometryHost.svelte';

const diagnostic = [
  'codex adapter exited before reporting models: exit status: 254',
  'npm error ENOENT: /Users/clement/.npm/_npx/39d488c67d3fe4d0/package.json',
  ...Array.from({ length: 12 }, () => `/Users/clement/${'long-directory/'.repeat(30)}package.json`),
].join('\n');

for (const placement of ['settings', 'modal'] as const) {
  test(`provider Details wraps and scrolls, closes with focus restored in ${placement}`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 360, height: 480 });
    await mount(ModelPickerGeometryHost, { props: { placement, diagnostic } });
    const trigger = page.getByRole('button', { name: 'Reasoning model · Auto', exact: true });
    await trigger.click();
    const details = page.getByRole('button', { name: 'Details', exact: true });
    await expect(details).toBeVisible();
    await expect(page.getByRole('option', { name: /Reasoning model/ })).toBeVisible();
    await testInfo.attach('provider-error', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await details.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: /Codex model loading details/ });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('pre')).toHaveText(diagnostic);
    const geometry = await dialog.evaluate((element) => {
      const body = element.querySelector('[data-slot="dialog-body"]')!;
      const rect = element.getBoundingClientRect();
      return {
        overflow: element.scrollWidth - element.clientWidth,
        top: rect.top,
        bottom: rect.bottom,
        scrolls: body.scrollHeight > body.clientHeight,
      };
    });
    expect(geometry.overflow).toBeLessThanOrEqual(1);
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.bottom).toBeLessThanOrEqual(480);
    expect(geometry.scrolls).toBe(true);
    await testInfo.attach('provider-details', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    if (placement === 'modal')
      await expect(page.getByRole('dialog', { name: 'Model settings' })).toBeVisible();
    await trigger.press('Enter');
    await details.click();
    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.press('Enter');
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(details).toHaveCount(0);
    await expect(page.getByRole('option', { name: /Reasoning model/ })).toBeVisible();
    await expect(page.getByTestId('refresh-requests')).toHaveText(
      JSON.stringify([{ channel: 'codex:get-models', params: { forceRefresh: true } }]),
    );
  });
}

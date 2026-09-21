import { expect, test } from '../../../../../test/ct-test';
import ToastStackPreview from '../toast-stack.preview.svelte';

test('conceals rear custom content and restores accessible actions when expanded', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 420, height: 700 });
  await mount(ToastStackPreview);
  const custom = page.locator('[data-sonner-toast][data-styled="false"]');
  const content = custom.locator('[data-toast-layout]');
  const front = page.locator('[data-sonner-toast][data-front="true"]');
  await expect(custom).toHaveAttribute('data-expanded', 'false');
  await expect(custom).toHaveAttribute('data-front', 'false');
  await expect(front).toHaveAttribute('data-mounted', 'true');
  await testInfo.attach('collapsed-stack', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await expect(content).toHaveCSS('opacity', '0');
  await expect(content).toHaveCSS('pointer-events', 'none');
  const fits = await front.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= innerWidth;
  });
  expect(fits).toBe(true);
  await front.hover();
  await expect(custom).toHaveAttribute('data-expanded', 'true');
  await expect(content).toHaveCSS('opacity', '1');
  await expect
    .poll(async () => {
      const a = (await custom.boundingBox())!;
      const b = (await front.boundingBox())!;
      return b.y - (a.y + a.height);
    })
    .toBeGreaterThanOrEqual(7);
  await custom.getByRole('button', { name: 'Switch To', exact: true }).click();
  await expect(page.getByTestId('toast-switches')).toHaveText('1');
  await page.mouse.move(410, 10);
  await page.getByRole('button', { name: 'Add success', exact: true }).focus();
  await expect(custom).toHaveAttribute('data-expanded', 'false');
  await page.keyboard.press('Alt+t');
  await expect(custom).toHaveAttribute('data-expanded', 'true');
  await custom.getByRole('button', { name: 'Later', exact: true }).press('Enter');
  await expect(custom).toHaveCount(0);
  await expect(front).toHaveCount(1);
  await front.getByRole('button', { name: /Close|Dismiss/i }).click();
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
});

for (const failure of [false, true]) {
  test(`separates ${failure ? 'failure' : 'discussion'} actions and keeps them usable`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: 420, height: 700 });
    await mount(ToastStackPreview, { props: { stacked: false, failure } });
    const content = page.locator('[data-toast-layout]');
    const primary = content.getByRole('button', {
      name: failure ? 'Retry preview' : 'Switch To',
      exact: true,
    });
    const secondary = content.getByRole('button', {
      name: failure ? 'Switch To' : 'Later',
      exact: true,
    });
    await expect(primary).toBeVisible();
    await expect(secondary).toBeVisible();
    const toast = page.locator('[data-sonner-toast]');
    await expect(toast).toHaveAttribute('data-mounted', 'true');
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(() => toast.evaluate((node) => node.getAnimations().length)).toBe(0);
    const actions = content.locator('.toast-actions').getByRole('button');
    await expect(actions).toHaveCount(2);
    // Read both controls in one frame, after their shared toast finishes entering.
    const [a, b] = await actions.evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().toJSON()),
    );
    expect(b.x - a.x - a.width).toBeGreaterThanOrEqual(8);
    expect(b.y).toBeCloseTo(a.y, 0);
    await primary.press('Enter');
    await expect(page.getByTestId(failure ? 'toast-retries' : 'toast-switches')).toHaveText('1');
    await secondary.press('Enter');
    if (failure) await expect(page.getByTestId('toast-switches')).toHaveText('1');
    else await expect(content).toHaveCount(0);
  });
}

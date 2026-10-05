import { expect, test } from '../../../../test/ct-test';
import Harness from './FirstLineIconHarness.svelte';

for (const fixture of [
  { kind: 'menu', width: 360 },
  { kind: 'accordion', width: 360 },
  { kind: 'radio', width: 360 },
  { kind: 'settings', width: 360 },
  { kind: 'settings', width: 900 },
]) {
  test(`${fixture.kind} icons stay on the first wrapped line at ${fixture.width}px`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: fixture.width, height: 800 });
    await mount(Harness, { props: { kind: fixture.kind } });
    const label =
      fixture.kind === 'radio'
        ? page.getByText('A long choice label that wraps onto another line', { exact: true })
        : page.locator('[data-audit-label], [data-field-label]').first();
    await expect(label).toBeVisible();
    const center = await label.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const first = range.getClientRects()[0];
      return first.top + first.height / 2;
    });
    const icons = page.locator('svg');
    for (const icon of await icons.all()) {
      const bounds = await icon.boundingBox();
      expect(bounds).not.toBeNull();
      expect(Math.abs(bounds!.y + bounds!.height / 2 - center)).toBeLessThanOrEqual(2);
    }
    if (fixture.kind === 'accordion') {
      await page.getByRole('button').click();
      await expect(page.getByText('Expanded details')).toBeVisible();
    }
  });
}

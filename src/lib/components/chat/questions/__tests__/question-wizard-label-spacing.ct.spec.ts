import { expect, test } from '../../../../../test/ct-test';
import QuestionWizardSpacingHost from './QuestionWizardSpacingHost.svelte';

test.afterEach(async ({ page }) => {
  expect(await page.pageErrors()).toEqual([]);
});

for (const [width, multiSelect] of [
  [720, false],
  [280, true],
] as const) {
  test(`keeps label-only choices compact through step changes at ${width}px`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const component = await mount(QuestionWizardSpacingHost, { props: { multiSelect } });
    await page.evaluate(() => document.fonts.ready);
    const described = component.getByRole('radio').first();
    const description = described.getByText('Preserve the current behavior.');
    const title = described.getByText('Small change', { exact: true });
    const [titleBox, descriptionBox] = await Promise.all([
      title.boundingBox(),
      description.boundingBox(),
    ]);
    expect(descriptionBox!.y).toBeGreaterThanOrEqual(titleBox!.y + titleBox!.height);
    await described.focus();
    await page.keyboard.press('Enter');
    const role = multiSelect ? 'checkbox' : 'radio';
    const rows = component.getByRole(role);
    await expect(rows).toHaveCount(4);
    const geometry = await rows.evaluateAll((nodes) =>
      nodes.map((node) => {
        const row = node.getBoundingClientRect();
        const children = [...node.children].map((child) => {
          const box = child.getBoundingClientRect();
          return {
            height: box.height,
            centerOffset: box.top + box.height / 2 - row.top - row.height / 2,
          };
        });
        return { height: row.height, overflow: node.scrollWidth - node.clientWidth, children };
      }),
    );
    await testInfo.attach('label-only-geometry', {
      body: JSON.stringify(geometry, null, 2),
      contentType: 'application/json',
    });
    await testInfo.attach('label-only-question', {
      body: await component.screenshot(),
      contentType: 'image/png',
    });
    for (const row of geometry) {
      expect.soft(row.height).toBeLessThanOrEqual(32);
      expect.soft(row.overflow).toBeLessThanOrEqual(1);
      for (const child of row.children)
        expect.soft(Math.abs(child.centerOffset)).toBeLessThanOrEqual(1);
    }
    await rows.first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(rows.nth(1)).toBeFocused();
    await page.keyboard.press('Enter');
    if (multiSelect) await component.getByRole('button', { name: /Continue/ }).click();
    await component.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(component.getByRole(role).nth(1)).toHaveAttribute('aria-checked', 'true');
    await component.getByRole('button', { name: 'Hide', exact: true }).click();
    await component.getByRole('button', { name: /Click to expand/i }).click();
    await expect(component.getByRole(role).nth(1)).toHaveAttribute('aria-checked', 'true');
    if (multiSelect) await component.getByRole('button', { name: /Continue/ }).click();
    else await component.getByRole(role).nth(1).click();
    const mixed = component.getByRole('checkbox');
    const [shortBox, wrappedBox, describedBox] = await Promise.all([
      mixed.nth(0).boundingBox(),
      mixed.nth(1).boundingBox(),
      mixed.nth(2).boundingBox(),
    ]);
    expect.soft(shortBox!.height).toBeLessThanOrEqual(32);
    expect.soft(describedBox!.height).toBeGreaterThan(shortBox!.height);
    if (width === 280) expect(wrappedBox!.height).toBeGreaterThan(shortBox!.height);
    expect(
      await component.evaluate((node) => node.scrollWidth - node.clientWidth),
    ).toBeLessThanOrEqual(1);
    await mixed.first().focus();
    await page.keyboard.press('Space');
    await component.getByRole('button', { name: /Continue/ }).click();
    await expect(component.getByTestId('question-spacing-result')).toContainText('Web');
    await expect(component.getByTestId('question-spacing-result')).toContainText('Focused tests');
  });
}

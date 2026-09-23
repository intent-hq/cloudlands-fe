import { expect, test } from '../../../../../test/ct-test';
import Preview from '../recent-repositories.preview.svelte';

for (const tab of ['Pick a repo', 'Copy local repo']) {
  test(`Recent ${tab} rows share left icon and text columns and remain selectable`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 560, height: 720 });
    await page.route('https://github.com/fixture-owner.png*', (route) => route.abort());
    const component = await mount(Preview);
    const centered = component.getByTestId('centered-action');
    const centerOffset = await centered.evaluate((element) => {
      const label = element.querySelector('[data-slot="button-label"]')!;
      const range = document.createRange();
      range.selectNodeContents(label);
      const text = range.getBoundingClientRect();
      const row = element.getBoundingClientRect();
      return text.left + text.width / 2 - row.left - row.width / 2;
    });
    expect(Math.abs(centerOffset)).toBeLessThan(1);

    const trigger = component.getByRole('button', { name: 'Choose fixture repository' });
    await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    await trigger.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('tab', { name: tab, exact: true }).click();
    const rows = page.getByTestId('recent-repositories').getByRole('button');
    await expect(rows).toHaveCount(3);
    const geometry = await rows.evaluateAll((elements) =>
      elements.map((element) => {
        const row = element.getBoundingClientRect();
        const leading = element
          .querySelector('[data-slot="action-row-leading"]')!
          .getBoundingClientRect();
        const title = element.querySelector('[data-slot="action-row-title"]')!;
        const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
        let text = walker.nextNode();
        while (text && !text.textContent?.trim()) text = walker.nextNode();
        const range = document.createRange();
        range.selectNodeContents(text!);
        const label = title.firstElementChild!;
        return {
          x: row.x,
          right: row.right,
          leadingX: leading.x,
          leadingWidth: leading.width,
          textX: range.getBoundingClientRect().x,
          textRight: label.getBoundingClientRect().right,
          clipped: label.scrollWidth > label.clientWidth,
        };
      }),
    );
    for (const row of geometry) {
      expect(row.leadingX - row.x).toBeCloseTo(8, 1);
      expect(row.leadingWidth).toBe(16);
      expect(row.textX - row.x).toBeCloseTo(32, 1);
      expect(row.leadingX).toBeCloseTo(geometry[0].leadingX, 1);
      expect(row.textX).toBeCloseTo(geometry[0].textX, 1);
      expect(row.textRight).toBeLessThanOrEqual(row.right - 8);
    }
    expect(geometry[2].clipped).toBe(true);

    await rows.first().click();
    const path = tab === 'Pick a repo' ? 'fixture-owner/app' : '/fixture/app';
    await expect(component.getByTestId('repo-selection')).toContainText(JSON.stringify(path));
    await expect(rows).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await dialog.getByRole('tab', { name: tab, exact: true }).click();
    await rows.nth(1).focus();
    await rows.nth(1).press('Enter');
    const secondPath = tab === 'Pick a repo' ? 'fixture-owner/tools' : '/fixture/tools';
    await expect(component.getByTestId('repo-selection')).toContainText(JSON.stringify(secondPath));
    await expect(rows).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
}

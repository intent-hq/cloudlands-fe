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
    const rows = page.getByTestId('recent-repositories').locator('[data-slot=menu-action-row]');
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

for (const tab of ['Pick a repo', 'Copy local repo']) {
  test(`Recent ${tab} dismissal is isolated, accessible, and survives source refresh`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 560, height: 720 });
    await page.route('https://github.com/fixture-owner.png*', (route) => route.abort());
    const component = await mount(Preview, { props: { persist: true } });
    const trigger = component.getByRole('button', { name: 'Choose fixture repository' });
    const open = async () => {
      await trigger.click();
      await page.getByRole('tab', { name: tab, exact: true }).click();
    };
    await open();
    const rows = page.locator('[data-recent-repo-row]');
    const remove = page.locator('[data-remove-recent-repo]');
    await expect(rows).toHaveCount(3);
    await page.mouse.move(0, 0);
    await expect(remove.first()).toHaveCSS('opacity', '0');
    await rows.first().hover();
    await expect(remove.first()).toHaveCSS('opacity', '1');
    const geometry = await rows.evaluateAll((elements) =>
      elements.map((element) => {
        const row = element.getBoundingClientRect();
        const button = element.querySelector('[data-remove-recent-repo]')!.getBoundingClientRect();
        const text = element.querySelector('[data-slot=action-row-title]')!.getBoundingClientRect();
        return {
          right: button.right,
          inset: row.right - button.right,
          gap: button.left - text.right,
        };
      }),
    );
    for (const row of geometry) {
      expect(row.inset).toBeCloseTo(8, 1);
      expect(row.right).toBeCloseTo(geometry[0].right, 1);
      expect(row.gap).toBeGreaterThanOrEqual(0);
    }
    const path = tab === 'Pick a repo' ? 'fixture-owner/app' : '/fixture/app';
    await expect(remove.first()).toHaveAccessibleName(`Remove ${path} from recent repositories`);
    await remove.first().click();
    await expect(rows).toHaveCount(2);
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(component.getByTestId('repo-selection')).toHaveText('null');
    await expect(remove.first()).toBeFocused();

    await page.keyboard.press('Escape');
    await open();
    await expect(rows).toHaveCount(2);
    await page.keyboard.press('Escape');
    // Remounting fetches the unchanged registry again.
    await component.getByRole('button', { name: 'Refresh fixture sources' }).click();
    await open();
    await expect(rows).toHaveCount(2);
    await expect(
      page.getByRole('button', { name: `Remove ${path} from recent repositories`, exact: true }),
    ).toHaveCount(0);

    // Tab reveals a separate button; Enter and Space do not select the repo.
    await rows.first().locator('[data-slot=menu-action-row]').focus();
    await page.keyboard.press('Tab');
    await expect(remove.first()).toBeFocused();
    await expect(remove.first()).toHaveCSS('opacity', '1');
    await page.keyboard.press('Enter');
    await expect(rows).toHaveCount(1);
    await expect(remove.first()).toBeFocused();
    await page.keyboard.press('Space');
    await expect(rows).toHaveCount(0);
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(component.getByTestId('repo-selection')).toHaveText('null');
    await expect(page.getByRole('tab', { name: tab, exact: true })).toBeFocused();
    if (tab === 'Pick a repo') await expect(page.getByRole('combobox')).toBeVisible();
    else await expect(page.getByRole('button', { name: 'Select a folder' })).toBeVisible();
    const otherTab = tab === 'Pick a repo' ? 'Copy local repo' : 'Pick a repo';
    await page.getByRole('tab', { name: otherTab, exact: true }).click();
    await expect(rows).toHaveCount(3);
    await rows.first().locator('[data-slot=menu-action-row]').click();
    await expect(component.getByTestId('repo-selection')).not.toHaveText('null');
  });
}

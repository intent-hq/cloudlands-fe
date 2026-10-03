import { expect, test } from '../../../../../test/ct-test';
import WorkspaceTokenUsageAccessibilityHost from './WorkspaceTokenUsageAccessibilityHost.svelte';

for (const scenario of [
  { name: 'many agents and models', width: 1100, mode: 'mixed' },
  { name: 'narrow viewport', width: 280, mode: 'mixed' },
  { name: 'message-only workspace', width: 1100, mode: 'all' },
] as const) {
  test(`keeps the summary visible and every message-only scope reachable: ${scenario.name}`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: scenario.width, height: 720 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const component = await mount(WorkspaceTokenUsageAccessibilityHost, {
      props: { manyMessageOnly: scenario.mode, width: Math.min(304, scenario.width - 48) },
    });
    await component.getByTestId('token-usage-disclosure').click();
    await page.evaluate(() => document.fonts.ready);
    const details = page.getByTestId('token-usage-details');
    const geometry = await details.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return {
        contained:
          box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth,
        outerScroll: element.scrollHeight - element.clientHeight,
        navigators: [...element.querySelectorAll('.navigator-row')].map((group) => {
          const label = group
            .querySelector('.navigator-selection > [title]')!
            .getBoundingClientRect();
          const options = group.querySelector('.message-only-options')!;
          const list = options.getBoundingClientRect();
          const bar = group.querySelector('.breakdown-stack')?.getBoundingClientRect();
          return {
            labelVisible: label.width > 0 && label.top >= box.top && label.bottom <= box.bottom,
            barVisible: !bar || (bar.top >= box.top && bar.bottom <= box.bottom),
            listBelowSummary: list.top >= (bar?.bottom ?? label.bottom),
            listScrollable: options.scrollHeight > options.clientHeight,
            horizontalOverflow: options.scrollWidth - options.clientWidth,
          };
        }),
      };
    });
    await testInfo.attach('popover-geometry', {
      body: JSON.stringify(geometry, null, 2),
      contentType: 'application/json',
    });
    await testInfo.attach('popover-open', {
      body: await details.screenshot(),
      contentType: 'image/png',
    });
    expect(geometry.contained).toBe(true);
    expect(geometry.outerScroll).toBeLessThanOrEqual(1);
    for (const navigator of geometry.navigators) {
      expect(navigator).toMatchObject({
        labelVisible: true,
        barVisible: true,
        listBelowSummary: true,
        listScrollable: true,
      });
      expect(navigator.horizontalOverflow).toBeLessThanOrEqual(1);
    }

    for (const name of ['By agent', 'By model']) {
      const group = details.getByRole('radiogroup', { name });
      const first = group.getByRole('radio').first();
      const last = group.getByRole('radio').last();
      await first.focus();
      await page.keyboard.press('End');
      await expect(last).toBeFocused();
      await expect(last).toBeChecked();
      expect(
        await group.locator('.message-only-options').evaluate((element) => element.scrollTop),
      ).toBeGreaterThan(0);
      expect(
        await last.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
          return hit !== null && element.contains(hit);
        }),
      ).toBe(true);
      await page.keyboard.press('Home');
      await expect(first).toBeFocused();
      await last.click();
      await expect(last).toBeChecked();
    }
    await page.mouse.move(0, 0);
    await expect(details.locator('.message-composition-label .animated-number-value')).toHaveText(
      '1 human message and 1 agent message',
    );
    expect(await details.evaluate((element) => element.scrollTop)).toBe(0);
    await testInfo.attach('last-scopes-selected', {
      body: await details.screenshot(),
      contentType: 'image/png',
    });
  });
}

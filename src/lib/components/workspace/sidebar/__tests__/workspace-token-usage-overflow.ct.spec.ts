import { expect, test } from '../../../../../test/ct-test';
import WorkspaceTokenUsageAccessibilityHost from './WorkspaceTokenUsageAccessibilityHost.svelte';

for (const scenario of [
  { name: 'many agents and models', width: 1100, mode: 'mixed' },
  { name: 'narrow viewport', width: 280, mode: 'mixed' },
  { name: 'message-only workspace', width: 1100, mode: 'all' },
] as const) {
  test(`keeps the summary visible without navigating message-only entries: ${scenario.name}`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: scenario.width, height: 720 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const component = await mount(WorkspaceTokenUsageAccessibilityHost, {
      props: {
        manyMessageOnly: scenario.mode,
        width: Math.min(304, scenario.width - 48),
        surroundingControls: true,
      },
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
        horizontalOverflow: element.scrollWidth - element.clientWidth,
        navigators: [...element.querySelectorAll('.navigator-row')].map((group) => {
          const label = group
            .querySelector('.navigator-selection > span:first-child')!
            .getBoundingClientRect();
          const bar = group.querySelector('.breakdown-stack')!.getBoundingClientRect();
          return {
            labelVisible: label.width > 0 && label.top >= box.top && label.bottom <= box.bottom,
            barVisible: bar.top >= box.top && bar.bottom <= box.bottom,
          };
        }),
      };
    });
    await testInfo.attach('popover-geometry', {
      body: JSON.stringify(geometry, null, 2),
      contentType: 'application/json',
    });
    expect(geometry.contained).toBe(true);
    expect(geometry.outerScroll).toBeLessThanOrEqual(1);
    expect(geometry.horizontalOverflow).toBeLessThanOrEqual(1);
    for (const navigator of geometry.navigators) {
      expect(navigator).toMatchObject({
        labelVisible: true,
        barVisible: true,
      });
    }
    if (scenario.mode === 'mixed') {
      for (const name of ['By agent', 'By model']) {
        const group = details.getByRole('radiogroup', { name });
        const control = group.getByRole('radio');
        await expect(control).toHaveCount(1);
        await control.focus();
        for (const key of ['End', 'ArrowRight', 'Home', 'ArrowLeft']) {
          await page.keyboard.press(key);
          await expect(control).toBeFocused();
          await expect(control).toBeChecked();
        }
        await control.click();
        await expect(control).toBeChecked();
      }
    } else {
      await expect(details.getByRole('radiogroup')).toHaveCount(0);
    }
    await page.mouse.move(0, 0);
    await expect(details.locator('.message-composition-label .animated-number-value')).toHaveText(
      scenario.mode === 'mixed'
        ? '1,241 human and 1,697 agent messages'
        : '100 human and 100 agent messages',
    );
    expect(await details.evaluate((element) => element.scrollTop)).toBe(0);
    const path = `.demo-artifacts/token-usage/without-icons-${scenario.mode}-${scenario.width}.png`;
    await details.screenshot({ path });
    await testInfo.attach('popover-without-icons', { path, contentType: 'image/png' });
    await page.keyboard.press('Tab');
    await expect(component.getByTestId('following-workspace-control')).toBeFocused();
    await expect(details).toHaveCount(0);
  });
}

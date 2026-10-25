import { expect, test } from '../../../../test/ct-test';
import Preview from '../chat-header-icons.preview.svelte';
import { probeHeaderIcons } from './chat-header-icon-probe';

for (const { width, theme, atBottom } of [
  { width: 620, theme: 'light', atBottom: false },
  { width: 320, theme: 'dark', atBottom: true },
]) {
  test(`chat header containment and keyboard targets at ${width}px in ${theme}`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width, height: 650 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(
      (dark) => document.documentElement.classList.toggle('dark', dark),
      theme === 'dark',
    );
    await mount(Preview, { props: { atBottom } });
    const fixture = page.getByTestId('chat-header-icons-preview');
    const header = fixture;
    const actions = header.locator('[data-chat-header-actions]');
    const geometry = await actions.evaluate(probeHeaderIcons);
    expect(geometry.map((icon) => icon.id)).toEqual([
      'task-progress-trigger',
      'browser-tabs-trigger',
      'chat-message-navigator-trigger',
      'chat-scroll-to-bottom-button',
    ]);
    const bounds = (await header.boundingBox())!;
    for (const icon of geometry) {
      expect(icon.target.x).toBeGreaterThanOrEqual(bounds.x);
      expect(icon.target.x + icon.target.width).toBeLessThanOrEqual(bounds.x + bounds.width);
    }
    const down = actions.getByTestId('chat-scroll-to-bottom-button');
    if (atBottom) {
      await expect(down).toBeDisabled();
      expect(geometry[3].opacity).toBeLessThan(geometry[2].opacity);
    } else {
      await down.focus();
      await page.keyboard.press('Enter');
      await expect(down).toBeDisabled();
    }
    const tasks = actions.getByTestId('task-progress-trigger');
    await tasks.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('task-progress-popover')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(tasks).toBeFocused();
    const chat = actions.getByTestId('chat-message-navigator-trigger');
    await chat.focus();
    await page.keyboard.press('Enter');
    const search = page.getByRole('combobox', { name: 'Filter user messages' });
    await expect(search).toBeFocused();
    await search.fill('Review');
    await page.keyboard.press('Enter');
    await expect(fixture).toHaveAttribute('data-selected-message', 'first');
    await actions.getByTestId('browser-tabs-trigger').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('browser-tab-close')).toBeVisible();
    await page.keyboard.press('Escape');
  });
}

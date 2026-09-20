import { expect, test } from '../../../../test/ct-test';
import Preview from '../pinned-row-parity.preview.svelte';
import { readPinnedRowPresentation } from './pinned-row-parity-probe';

const cases = [
  { name: 'sender avatar', kind: 'agent', narrow: false },
  { name: 'wrapping monospace sender', kind: 'agent', narrow: true },
  { name: 'event avatar and summary', kind: 'event', narrow: false },
  { name: 'hook wake', kind: 'hook', narrow: false },
  { name: 'PR wake', kind: 'pr', narrow: false },
  { name: 'Chief sender', kind: 'chief', narrow: false },
] as const;

for (const scenario of cases) {
  test(`pinned ${scenario.name} matches its source and returns without opening details`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(
      (dark) => document.documentElement.classList.toggle('dark', dark),
      scenario.narrow,
    );
    const component = await mount(Preview, {
      props: { kind: scenario.kind, narrow: scenario.narrow },
    });
    await page.evaluate(() => document.fonts.ready);
    const source = component.getByTestId('source-0');
    const surface = source.locator(
      '[data-testid="user-message-surface"], [data-testid="event-wakeup-card"]',
    );
    const normal = await surface.evaluate(readPinnedRowPresentation);
    const scroll = component.getByTestId('sticky-scroll');
    const scrollHeight = await scroll.evaluate((node) => node.scrollHeight);
    const entry = await source.evaluate((node) => {
      const viewport = node.closest<HTMLElement>('[data-testid="sticky-scroll"]')!;
      return (
        viewport.scrollTop +
        node.getBoundingClientRect().bottom -
        viewport.getBoundingClientRect().top +
        2
      );
    });
    const pinned = component.getByTestId('pinned-user-prompt');

    for (const activation of ['Enter', 'Space', 'click'] as const) {
      await scroll.evaluate((node, top) => node.scrollTo(0, top), entry);
      await expect(pinned).toBeVisible();
      await expect.poll(() => pinned.evaluate(readPinnedRowPresentation)).toEqual(normal);
      expect(await surface.evaluate(readPinnedRowPresentation)).toEqual(normal);
      expect(await scroll.evaluate((node) => node.scrollHeight)).toBe(scrollHeight);
      expect(await scroll.evaluate((node) => node.scrollTop)).toBeCloseTo(entry, 1);
      await expect(pinned).not.toContainText('Details are available only in the expanded source.');
      await expect(pinned.locator('button button, button a')).toHaveCount(0);
      await expect(pinned.locator('[aria-expanded], [aria-controls]')).toHaveCount(0);
      const target = pinned.getByRole('button').last();
      await target.focus();
      await expect(target).toBeFocused();
      if (activation === 'click') await target.click();
      else await page.keyboard.press(activation);
      await expect(pinned).toHaveCount(0);
      await expect(source).toBeInViewport();
    }
  });
}

import { expect, test } from '@playwright/experimental-ct-svelte';
import ResponseGroupCollapseHost from './ResponseGroupCollapseHost.svelte';

function channel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

function rgb(value: string): [number, number, number] {
  const channels = value
    .match(/[0-9.]+/g)
    ?.slice(0, 3)
    .map(Number);
  if (!channels || channels.length !== 3) throw new Error(`Unsupported color: ${value}`);
  return [channels[0], channels[1], channels[2]];
}

function ratio(foreground: string, background: string): number {
  const luminance = (color: string) => {
    const [red, green, blue] = rgb(color).map(channel);
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

for (const theme of ['light', 'dark'] as const) {
  test(`fully collapses streaming groups with accessible motion in ${theme}`, async ({
    mount,
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const component = await mount(ResponseGroupCollapseHost, {
      props: { theme, width: 260, zoom: 2, chunk: 'initial chunk' },
    });
    const scroll = component.getByTestId('response-group-scroll');
    await scroll.evaluate((element) => (element.scrollTop = element.scrollHeight));

    for (const position of ['first', 'middle', 'last'] as const) {
      const group = component.getByTestId(`response-group-${position}`);
      const trigger = group.locator('[data-operational-disclosure-row]');
      const body = group.locator('[data-operational-expanded-content]');
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      await expect(body).toHaveCount(1);

      if (position === 'first') {
        const motion = await trigger.evaluate(async (element) => {
          element.click();
          await new Promise(requestAnimationFrame);
          const details = element.parentElement?.querySelector(
            '[data-operational-expanded-content]',
          );
          const frames = details?.getAnimations()[0]?.effect?.getKeyframes() ?? [];
          return frames.map((frame) => ({
            height: String(frame.height ?? ''),
            opacity: String(frame.opacity ?? ''),
            transform: String(frame.transform ?? ''),
          }));
        });
        expect(motion.some((frame) => frame.height === '0px')).toBe(true);
        expect(motion.some((frame) => frame.opacity === '0')).toBe(true);
        expect(motion.some((frame) => frame.transform.includes('-4px'))).toBe(true);
      } else {
        await trigger.click();
      }

      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await expect(body).toHaveCount(0);
      await expect(group.locator('.cylinder-scroller')).toHaveCount(0);
      await expect(group.getByTestId(`response-group-focus-${position}`)).toHaveCount(0);
      await expect(group.locator('[data-testid="response-group-snippet"]')).toHaveCount(1);
    }

    const snippet = component
      .getByTestId('response-group-first')
      .locator('[data-testid="response-group-snippet"]');
    const colors = await snippet.evaluate((element) => ({
      foreground: getComputedStyle(element).color,
      background: getComputedStyle(
        document.querySelector('[data-testid="response-group-collapse-host"]')!,
      ).backgroundColor,
      whiteSpace: getComputedStyle(element.parentElement!).whiteSpace,
    }));
    expect(ratio(colors.foreground, colors.background)).toBeGreaterThanOrEqual(4.5);
    expect(colors.whiteSpace).toBe('nowrap');

    await component.update({ props: { theme, width: 260, zoom: 2, chunk: 'new chunk' } });
    for (const position of ['first', 'middle', 'last'] as const) {
      const group = component.getByTestId(`response-group-${position}`);
      await expect(group.locator('[data-operational-disclosure-row]')).toHaveAttribute(
        'aria-expanded',
        'false',
      );
      await expect(group.locator('[data-operational-expanded-content]')).toHaveCount(0);
      await expect(group.locator('[data-testid="response-group-snippet"]')).toContainText(
        'new chunk',
      );
    }

    const first = component.getByTestId('response-group-first');
    const firstTrigger = first.locator('[data-operational-disclosure-row]');
    await firstTrigger.click();
    await expect(firstTrigger).toHaveAttribute('aria-expanded', 'true');
    const focusTarget = first.getByTestId('response-group-focus-first');
    await focusTarget.focus();
    await firstTrigger.evaluate((element) => element.click());
    await expect(firstTrigger).toHaveAttribute('aria-expanded', 'false');
    await expect(focusTarget).toHaveCount(0);
    await expect(firstTrigger).toBeFocused();

    const bottomGap = await scroll.evaluate(
      (element) => element.scrollHeight - element.clientHeight - element.scrollTop,
    );
    expect(bottomGap).toBeCloseTo(0, 1);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    const middle = component.getByTestId('response-group-middle');
    const middleTrigger = middle.locator('[data-operational-disclosure-row]');
    await middleTrigger.click();
    await expect(middleTrigger).toHaveAttribute('aria-expanded', 'true');
    expect(
      await middle
        .locator('[data-operational-expanded-content]')
        .evaluate((element) => element.getAnimations().map((animation) => animation.playState)),
    ).toEqual([]);
  });
}

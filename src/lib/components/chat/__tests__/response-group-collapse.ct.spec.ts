import { expect, test } from '@playwright/experimental-ct-svelte';
import ResponseGroupCollapseHost from './ResponseGroupCollapseHost.svelte';

test('auto-collapses every completed group while later response activity remains', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ResponseGroupCollapseHost, {
    props: { width: 320, zoom: 1, streaming: true, livePreview: false },
  });
  const lastFocus = component.getByTestId('response-group-focus-last');
  await lastFocus.focus();

  await component.update({ props: { width: 320, zoom: 1, streaming: false } });
  for (const position of ['first', 'middle', 'last'] as const) {
    const group = component.getByTestId(`response-group-${position}`);
    await expect(group.getByTestId('response-group-disclosure')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await expect(group.locator('[data-operational-expanded-content]')).toHaveCount(0);
  }
  await expect(component.getByTestId('response-group-disclosure').last()).toBeFocused();
  await expect(component.getByTestId('response-after-groups')).toHaveText(
    'Later response activity',
  );

  const finalTrigger = component.getByTestId('response-group-disclosure').last();
  await finalTrigger.click();
  await expect(finalTrigger).toHaveAttribute('aria-expanded', 'true');
});

test('keeps only the terminal completed group open until later visible content follows', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ResponseGroupCollapseHost, {
    props: {
      width: 320,
      zoom: 1,
      streaming: true,
      terminalPosition: 'last',
      afterGroupsVisible: false,
    },
  });

  await component.update({
    props: {
      width: 320,
      zoom: 1,
      streaming: false,
      terminalPosition: 'last',
      afterGroupsVisible: false,
    },
  });
  await expect(component.getByTestId('response-group-disclosure').nth(0)).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(component.getByTestId('response-group-disclosure').nth(1)).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(component.getByTestId('response-group-disclosure').nth(2)).toHaveAttribute(
    'aria-expanded',
    'true',
  );

  await component.update({
    props: {
      width: 320,
      zoom: 1,
      streaming: false,
      terminalPosition: null,
      afterGroupsVisible: true,
    },
  });
  await expect(component.getByTestId('response-group-disclosure').nth(2)).toHaveAttribute(
    'aria-expanded',
    'false',
  );
});

test('mounts the conversation-final terminal group expanded and keeps it expanded on demotion', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ResponseGroupCollapseHost, {
    props: {
      width: 320,
      zoom: 1,
      streaming: false,
      livePreview: false,
      terminalPosition: 'last',
      lastConversationMessage: true,
      afterGroupsVisible: false,
    },
  });

  await expect(component.getByTestId('response-group-disclosure').nth(0)).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(component.getByTestId('response-group-disclosure').nth(1)).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  const finalTrigger = component.getByTestId('response-group-disclosure').nth(2);
  await expect(finalTrigger).toHaveAttribute('aria-expanded', 'true');

  await component.update({
    props: {
      width: 320,
      zoom: 1,
      streaming: false,
      livePreview: false,
      terminalPosition: 'last',
      lastConversationMessage: false,
      afterGroupsVisible: false,
    },
  });
  await expect(finalTrigger).toHaveAttribute('aria-expanded', 'true');
});

test('mounts every group collapsed when the completed message is not conversation-final', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ResponseGroupCollapseHost, {
    props: {
      width: 320,
      zoom: 1,
      streaming: false,
      livePreview: false,
      terminalPosition: 'last',
      lastConversationMessage: false,
      afterGroupsVisible: false,
    },
  });

  for (const index of [0, 1, 2]) {
    await expect(component.getByTestId('response-group-disclosure').nth(index)).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  }
});

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
  test(`toggles streaming groups between the cylinder and full history in ${theme}`, async ({
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
      const groupContainer = group.locator('[data-operational-row-container]');
      const trigger = group.getByTestId('response-group-disclosure');
      const body = group.locator('[data-operational-expanded-content]');
      const preview = group.locator('[data-operational-preview-content]');
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await expect(body).toHaveCount(0);
      await expect(preview).toHaveCount(1);
      await expect(group.locator('[data-response-group-child]')).toHaveCount(2);
      await expect(group.getByTestId(`response-group-focus-${position}`)).toHaveText(
        `Focusable ${position} detail for initial chunk`,
      );
      const collapsedTree = await group.ariaSnapshot();
      expect(collapsedTree).toContain(`button "${position} group: earlier chunk"`);
      expect(collapsedTree).toContain(`Focusable ${position} detail`);
      await trigger.click();
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      await expect(body).toHaveCount(1);
      await expect(preview).toHaveCount(0);
      await expect(group.locator('[data-response-group-child]')).toHaveCount(2);
      await expect(group.getByTestId(`response-group-focus-${position}`)).toHaveText(
        `Focusable ${position} detail for initial chunk`,
      );
      await expect(groupContainer).toHaveCSS('margin-bottom', '12px');

      const closingState = await trigger.evaluate(async (element) => {
        element.click();
        await Promise.resolve();
        const controlled = document.getElementById(element.getAttribute('aria-controls')!);
        return controlled
          ? {
              inert: controlled.hasAttribute('inert'),
              ariaHidden: controlled.getAttribute('aria-hidden'),
            }
          : null;
      });
      expect(closingState).toEqual({ inert: true, ariaHidden: 'true' });
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await expect(body).toHaveCount(0);
      await expect(preview).toHaveCount(1);
      await expect(group.locator('[data-response-group-child]')).toHaveCount(2);
      await expect(group.getByTestId(`response-group-focus-${position}`)).toHaveCount(1);
      await expect(groupContainer).toHaveCSS('margin-bottom', '0px');
    }
    await scroll.evaluate((element) => (element.scrollTop = element.scrollHeight));

    const summary = component
      .getByTestId('response-group-first')
      .locator('[data-testid="response-group-summary"]');
    const colors = await summary.evaluate((element) => ({
      foreground: getComputedStyle(element).color,
      background: getComputedStyle(
        document.querySelector('[data-testid="response-group-collapse-host"]')!,
      ).backgroundColor,
    }));
    expect(ratio(colors.foreground, colors.background)).toBeGreaterThanOrEqual(4.5);

    await component.update({ props: { theme, width: 260, zoom: 2, chunk: 'new chunk' } });
    for (const position of ['first', 'middle', 'last'] as const) {
      const group = component.getByTestId(`response-group-${position}`);
      await expect(group.locator('[data-operational-expanded-content]')).toHaveCount(0);
      await expect(group.locator('[data-operational-preview-content]')).toHaveCount(1);
      await expect(group.getByTestId(`response-group-focus-${position}`)).toHaveText(
        `Focusable ${position} detail for new chunk`,
      );
    }

    const bottomGap = await scroll.evaluate(
      (element) => element.scrollHeight - element.clientHeight - element.scrollTop,
    );
    expect(bottomGap).toBeCloseTo(0, 1);

    const first = component.getByTestId('response-group-first');
    const firstTrigger = first.getByTestId('response-group-disclosure');
    await firstTrigger.press('Enter');
    await expect(firstTrigger).toHaveAttribute('aria-expanded', 'true');
    const focusTarget = first.getByTestId('response-group-focus-first');
    await focusTarget.focus();
    await firstTrigger.evaluate((element) => element.click());
    await expect(firstTrigger).toHaveAttribute('aria-expanded', 'false');
    await expect(focusTarget).toHaveCount(1);
    await expect(firstTrigger).toBeFocused();
    await firstTrigger.press('Space');
    await expect(firstTrigger).toHaveAttribute('aria-expanded', 'true');
    await firstTrigger.click();
    await expect(firstTrigger).toHaveAttribute('aria-expanded', 'false');
  });

  test(`keeps tick-driven collapse motion in ${theme}`, async ({ mount, page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const component = await mount(ResponseGroupCollapseHost, {
      props: { theme, width: 260, zoom: 2, livePreview: false },
    });
    const first = component.getByTestId('response-group-first');
    const trigger = first.getByTestId('response-group-disclosure');
    const body = first.locator('[data-operational-expanded-content]');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(body).toHaveCount(1);

    const motion = await trigger.evaluate(async (element) => {
      const details = element
        .closest('[data-operational-row-container]')
        ?.querySelector('[data-operational-expanded-content]') as HTMLElement | null;
      if (!details) return [];
      const frames: { height: string; opacity: string; transform: string }[] = [];
      const record = () => {
        frames.push({
          height: details.style.height,
          opacity: details.style.opacity,
          transform: details.style.transform,
        });
      };
      const observer = new MutationObserver(record);
      observer.observe(details, { attributes: true, attributeFilter: ['style'] });
      element.click();
      for (let frame = 0; frame < 120 && details.isConnected; frame += 1) {
        await new Promise(requestAnimationFrame);
      }
      if (observer.takeRecords().length > 0) record();
      observer.disconnect();
      return frames;
    });
    expect(motion.some((frame) => frame.height === '0px')).toBe(true);
    expect(motion.some((frame) => frame.opacity === '0')).toBe(true);
    expect(motion.some((frame) => frame.transform.includes('-4px'))).toBe(true);
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(body).toHaveCount(0);
    await expect(first.locator('.cylinder-scroller')).toHaveCount(0);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    const middleTrigger = component
      .getByTestId('response-group-middle')
      .getByTestId('response-group-disclosure');
    await middleTrigger.click();
    await expect(middleTrigger).toHaveAttribute('aria-expanded', 'false');
    await middleTrigger.click();
    await expect(middleTrigger).toHaveAttribute('aria-expanded', 'true');
    await expect
      .poll(() =>
        component
          .getByTestId('response-group-middle')
          .locator('[data-operational-expanded-content]')
          .evaluate((element) => element.getAnimations().map((animation) => animation.playState)),
      )
      .toEqual([]);
  });
}

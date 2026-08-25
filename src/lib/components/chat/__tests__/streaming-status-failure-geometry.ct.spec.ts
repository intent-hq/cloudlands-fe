import { expect, test } from '@playwright/experimental-ct-svelte';
import StreamingStatusFailureGeometryHost from './StreamingStatusFailureGeometryHost.svelte';

test.setTimeout(120_000);

test('keeps failed-response controls aligned and contained across the production matrix', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as typeof window & { copiedFailureText?: string }).copiedFailureText = value;
        },
      },
    });
  });
  const component = await mount(StreamingStatusFailureGeometryHost);
  let resetKey = 0;

  for (const theme of ['light', 'dark'] as const) {
    for (const width of [240, 720]) {
      for (const zoom of [1, 2]) {
        for (const longError of [false, true]) {
          for (const expanded of [false, true]) {
            const preceding = longError ? 'event' : 'assistant';
            await component.update({
              props: {
                theme,
                width,
                zoom,
                preceding,
                longError,
                failedAt: longError,
                resetKey: ++resetKey,
              },
            });
            const alert = component.getByRole('alert');
            const message = component.getByTestId('error-message');
            await expect(alert).toHaveCount(1);
            if (expanded) await message.click();
            await expect(alert).toBeVisible();

            const geometry = await alert.evaluate((node) => {
              const box = (element: Element) => element.getBoundingClientRect();
              const copy = node.querySelector<HTMLButtonElement>(
                'button[aria-label="Copy error details to clipboard"]',
              )!;
              const icon = copy.querySelector('svg')!;
              const message = node.querySelector<HTMLElement>('[data-testid="error-message"]')!;
              const retry = node.querySelector<HTMLButtonElement>(
                'button[aria-label="Try again"]',
              )!;
              const host = node.closest('[data-testid="failed-response-geometry-host"]')!;
              const preceding = host.querySelector('[data-testid="preceding-surface"]')!;
              const wrapper = host.querySelector('[data-testid="failed-response-wrapper"]')!;
              const following = host.querySelector('[data-testid="following-surface"]')!;
              const alertBox = box(node);
              const copyBox = box(copy);
              const iconBox = box(icon);
              const messageBox = box(message);
              const retryBox = box(retry);
              const messageStyle = getComputedStyle(message);
              return {
                alertOverflow: node.scrollWidth - node.clientWidth,
                topGap: alertBox.top - box(preceding).bottom,
                internalBottomGap: box(wrapper).bottom - alertBox.bottom,
                bottomRhythm: box(following).top - alertBox.bottom,
                marginTop: getComputedStyle(node).marginTop,
                wrapperMarginBottom: getComputedStyle(wrapper).marginBottom,
                copySize: [copyBox.width, copyBox.height],
                iconSize: [iconBox.width, iconBox.height],
                copyCenter: (copyBox.top + copyBox.bottom) / 2,
                iconCenter: (iconBox.top + iconBox.bottom) / 2,
                messageTop: messageBox.top,
                lineHeight: Number.parseFloat(messageStyle.lineHeight),
                messageRight: messageBox.right,
                alertRight: alertBox.right,
                retryRight: retryBox.right,
                retryTop: retryBox.top,
                alertTop: alertBox.top,
                alertPaddingTop: Number.parseFloat(getComputedStyle(node).paddingTop),
                whiteSpace: messageStyle.whiteSpace,
                overflow: messageStyle.overflow,
                overflowWrap: messageStyle.overflowWrap,
              };
            });

            expect(geometry.alertOverflow).toBeLessThanOrEqual(0);
            expect(geometry.marginTop).toBe('8px');
            expect(geometry.topGap).toBeCloseTo(8 * zoom, 1);
            expect(geometry.internalBottomGap).toBeCloseTo(0, 1);
            expect(geometry.wrapperMarginBottom).toBe('64px');
            expect(geometry.bottomRhythm).toBeCloseTo(64 * zoom, 1);
            expect(geometry.copySize).toEqual([28 * zoom, 28 * zoom]);
            expect(geometry.iconSize).toEqual([16 * zoom, 16 * zoom]);
            const firstLineCenter = geometry.messageTop + (geometry.lineHeight * zoom) / 2;
            const state = { theme, width, zoom, longError, expanded, geometry };
            expect(
              Math.abs(geometry.copyCenter - firstLineCenter),
              JSON.stringify(state),
            ).toBeLessThanOrEqual(zoom);
            expect(
              Math.abs(geometry.iconCenter - firstLineCenter),
              JSON.stringify(state),
            ).toBeLessThanOrEqual(zoom);
            expect(geometry.messageRight).toBeLessThanOrEqual(geometry.alertRight + 0.5);
            expect(geometry.retryRight).toBeLessThanOrEqual(geometry.alertRight + 0.5);
            expect(geometry.retryTop).toBeCloseTo(
              geometry.alertTop + geometry.alertPaddingTop * zoom,
              1,
            );
            if (expanded) {
              expect(geometry.whiteSpace).toBe('pre-wrap');
              expect(geometry.overflowWrap).toBe('break-word');
            } else {
              expect(geometry.whiteSpace).toBe('nowrap');
              expect(geometry.overflow).toBe('hidden');
            }
          }
        }
      }
    }
  }
});

test('preserves spacing, keyboard copy feedback, retry, and forced-color focus', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' });
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as typeof window & { copiedFailureText?: string }).copiedFailureText = value;
        },
      },
    });
  });
  const component = await mount(StreamingStatusFailureGeometryHost, {
    props: { preceding: 'assistant', failedAt: true, width: 240, zoom: 2 },
  });
  const alert = component.getByRole('alert');
  const copy = component.getByRole('button', { name: 'Copy error details' });
  const retry = component.getByRole('button', { name: 'Try again' });
  const before = await copy.boundingBox();

  await copy.focus();
  await copy.press('Enter');
  await expect(copy.locator('[data-icon="check"]')).toBeVisible();
  await expect(copy).toBeFocused();
  expect(await copy.boundingBox()).toEqual(before);
  expect(
    await page.evaluate(
      () => (window as typeof window & { copiedFailureText?: string }).copiedFailureText,
    ),
  ).toBe('Response failed\n\nProvider stopped the response');
  await retry.click();
  await expect(component).toHaveAttribute('data-retry-count', '1');

  const spacing = await component.evaluate((root) => {
    const preceding = root.querySelector('[data-testid="preceding-surface"]')!;
    const alert = root.querySelector('[role="alert"]')!;
    const wrapper = root.querySelector('[data-testid="failed-response-wrapper"]')!;
    const following = root.querySelector('[data-testid="following-surface"]')!;
    return {
      topGap: alert.getBoundingClientRect().top - preceding.getBoundingClientRect().bottom,
      internalBottomGap:
        wrapper.getBoundingClientRect().bottom - alert.getBoundingClientRect().bottom,
      bottomRhythm: following.getBoundingClientRect().top - alert.getBoundingClientRect().bottom,
      marginTop: getComputedStyle(alert).marginTop,
      wrapperMarginBottom: getComputedStyle(wrapper).marginBottom,
    };
  });
  expect(spacing.marginTop).toBe('8px');
  expect(spacing.topGap).toBeCloseTo(16, 1);
  expect(spacing.internalBottomGap).toBeCloseTo(0, 1);
  expect(spacing.wrapperMarginBottom).toBe('64px');
  expect(spacing.bottomRhythm).toBeCloseTo(128, 1);

  await component.update({ props: { preceding: 'none', width: 240, zoom: 2, resetKey: 1 } });
  const leadingGap = await alert.evaluate((node) => {
    const wrapper = node.closest('[data-testid="failed-response-wrapper"]')!;
    return {
      gap: node.getBoundingClientRect().top - wrapper.getBoundingClientRect().top,
      marginTop: getComputedStyle(node).marginTop,
    };
  });
  expect(leadingGap).toEqual({ gap: 0, marginTop: '0px' });
});

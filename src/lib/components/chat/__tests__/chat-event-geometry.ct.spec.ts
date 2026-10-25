import { expect, test } from '../../../../test/ct-test';
import ChatEventGeometryHost from './ChatEventGeometryHost.svelte';

for (const theme of ['light', 'dark'] as const) {
  for (const width of [360, 960] as const) {
    for (const zoom of [1, 2] as const) {
      test(`subscription cards fit transcript lanes in ${theme} at ${width}px and ${zoom * 100}%`, async ({
        mount,
        page,
      }, testInfo) => {
        // Tailwind's sm: margin follows the viewport, independently of CSS zoom.
        await page.setViewportSize({ width, height: 900 });
        const props = { panelId: 'subscription-lane', theme, width, zoom };
        const component = await mount(ChatEventGeometryHost, {
          props: { ...props, subscriptionLane: 'chief-message' },
        });
        for (const subscriptionLane of ['chief-message', 'chief-flush', 'regular'] as const) {
          await component.update({ props: { ...props, subscriptionLane } });
          const clip = component.getByTestId('subscription-clip');
          const clipBounds = await clip.boundingBox();
          for (const surfaceId of ['event-wakeup-card', 'user-message-surface']) {
            const surface = await clip.getByTestId(surfaceId).boundingBox();
            expect(surface!.x).toBeGreaterThanOrEqual(clipBounds!.x);
            expect(surface!.x + surface!.width).toBeLessThanOrEqual(
              clipBounds!.x + clipBounds!.width,
            );
          }
          expect(await clip.evaluate((node) => node.scrollWidth - node.clientWidth)).toBe(0);
          if (
            subscriptionLane === 'chief-message' &&
            theme === 'light' &&
            width === 360 &&
            zoom === 1
          ) {
            await clip.screenshot({ path: testInfo.outputPath('compact-chief-fixed.png') });
          }
        }
      });
    }
  }
}

function contrastRatio(foreground: string, background: string): number {
  const luminance = (value: string) => {
    const channels = value
      .match(/[\d.]+/g)
      ?.slice(0, 3)
      .map(Number);
    if (!channels || channels.length !== 3) throw new Error(`Unsupported color: ${value}`);
    const linear = channels.map((channel) => {
      const normalized = channel / 255;
      return normalized <= 0.04045
        ? normalized / 12.92
        : Math.pow((normalized + 0.055) / 1.055, 2.4);
    });
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  };
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

for (const theme of ['light', 'dark'] as const) {
  for (const zoom of [1, 2] as const) {
    for (const chiefVariant of [false, true]) {
      test(`uses canonical sidebar user-message colors in ${theme} at ${zoom * 100}% (chiefVariant=${chiefVariant})`, async ({
        mount,
      }) => {
        const component = await mount(ChatEventGeometryHost, {
          props: { panelId: `colors-${theme}-${zoom}-${chiefVariant}`, theme, zoom, chiefVariant },
        });
        await component.getByTestId('sticky-scroll').evaluate((node) => node.scrollTo(0, 330));
        await expect(component.getByTestId('pinned-user-prompt')).toBeVisible();

        const styles = await component.evaluate((root, theme) => {
          const style = (selector: string, pseudo?: string) =>
            getComputedStyle(root.querySelector(selector) as Element, pseudo);
          const resolveToken = (token: string, property: 'backgroundColor' | 'color') => {
            const probe = document.createElement('span');
            probe.style[property] = `hsl(${getComputedStyle(root).getPropertyValue(token)})`;
            root.append(probe);
            const value = getComputedStyle(probe)[property];
            probe.remove();
            return value;
          };
          return {
            surface: resolveToken('--sidebar', 'backgroundColor'),
            themeSurface: resolveToken(`--theme-${theme}-sidebar`, 'backgroundColor'),
            surfaceForeground: resolveToken('--secondary-foreground', 'color'),
            ordinaryBackground: style('[data-testid="sent-card"]').backgroundColor,
            pinnedBackground: style('[data-testid="pinned-user-prompt"]').backgroundColor,
            attributedBackground: style(
              '[data-testid="attributed-message-lane"] [data-testid="user-message-surface"]',
            ).backgroundColor,
            eventBackground: style('[data-testid="event-wakeup-card"]').backgroundColor,
            ordinaryText: style('[data-testid="ordinary-user-text"]').color,
            pinnedText: style('[data-testid="pinned-user-prompt-text"]').color,
            linkText: style('[data-testid="ordinary-user-link"]').color,
            codeText: style('[data-testid="ordinary-user-code"]').color,
            codeBackground: style('[data-testid="ordinary-user-code"]').backgroundColor,
            selectionBackground: style('[data-testid="pinned-user-prompt-text"]', '::selection')
              .backgroundColor,
            selectionText: style('[data-testid="pinned-user-prompt-text"]', '::selection').color,
          };
        }, theme);

        expect(styles.surface).toBe(styles.themeSurface);
        expect(styles.ordinaryBackground).toBe(styles.surface);
        expect(styles.pinnedBackground).toBe(styles.surface);
        expect(styles.attributedBackground).toBe(styles.surface);
        expect(styles.eventBackground).toBe(styles.surface);
        expect(styles.ordinaryText).toBe(styles.surfaceForeground);
        expect(styles.pinnedText).toBe(styles.surfaceForeground);
        expect(styles.linkText).toBe(styles.surfaceForeground);
        expect(styles.codeText).toBe(styles.surfaceForeground);
        expect(styles.codeBackground).toBe('rgba(0, 0, 0, 0)');
        expect(contrastRatio(styles.pinnedText, styles.pinnedBackground)).toBeGreaterThanOrEqual(
          4.5,
        );
        expect(contrastRatio(styles.linkText, styles.ordinaryBackground)).toBeGreaterThanOrEqual(
          4.5,
        );
        expect(contrastRatio(styles.codeText, styles.ordinaryBackground)).toBeGreaterThanOrEqual(
          4.5,
        );
        expect(
          contrastRatio(styles.selectionText, styles.selectionBackground),
        ).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
}

test('tracks sticky entry, streaming, pagination, and per-panel ownership', async ({
  mount,
  page,
}) => {
  const first = await mount(ChatEventGeometryHost, { props: { panelId: 'first' } });
  await first.getByTestId('sticky-scroll').evaluate((node) => node.scrollTo(0, 330));
  await expect(first.getByTestId('pinned-user-prompt')).toBeVisible();

  await first.locator('[data-pinnable-user-prompt]').evaluate((node) => {
    const source = node as HTMLElement & { __pinnedPromptMessage?: unknown };
    source.__pinnedPromptMessage = {
      id: 'first-prompt',
      role: 'user',
      contentBlocks: [{ type: 'text', text: 'Streaming update' }],
    };
    source.textContent = 'Streaming update';
  });
  await expect(first.getByTestId('pinned-user-prompt')).toContainText('Streaming update');
  await first.getByTestId('sticky-scroll').evaluate((node) => {
    const spacer = document.createElement('div');
    spacer.style.height = '120px';
    node.prepend(spacer);
    node.scrollTo(0, 450);
  });
  await expect(first.getByTestId('pinned-user-prompt')).toBeVisible();

  await mount(ChatEventGeometryHost, { props: { panelId: 'second' } });
  const firstPanel = page.locator('[data-panel="first"]');
  const secondPanel = page.locator('[data-panel="second"]');
  await expect(firstPanel.getByTestId('pinned-user-prompt')).toBeVisible();
  await expect(secondPanel.getByTestId('pinned-user-prompt')).toHaveCount(0);

  await firstPanel.getByTestId('sticky-scroll').evaluate((node) => node.scrollTo(0, 0));
  await expect(firstPanel.getByTestId('pinned-user-prompt')).toHaveCount(0);
});

test('uses a deterministic non-animated sticky surface with reduced motion', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(ChatEventGeometryHost, { props: { panelId: 'reduced' } });
  await component.getByTestId('sticky-scroll').evaluate((node) => node.scrollTo(0, 330));
  const prompt = component.getByTestId('pinned-user-prompt');
  await expect(prompt).toBeVisible();
  expect(
    await prompt.evaluate((node) => Number.parseFloat(getComputedStyle(node).transitionDuration)),
  ).toBeLessThanOrEqual(0.001);
});

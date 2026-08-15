import { expect, test } from '@playwright/experimental-ct-svelte';
import ChatEventGeometryHost from './ChatEventGeometryHost.svelte';

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

test('measures the production finished-card turn gap across all required states', async ({
  mount,
  page,
}) => {
  const component = await mount(ChatEventGeometryHost, { props: { panelId: 'geometry' } });
  const summary = component.getByTestId('event-wakeup-summary');
  let measuredStates = 0;
  for (const theme of ['light', 'dark'] as const) {
    for (const width of [360, 960]) {
      for (const zoom of [1, 2]) {
        for (const finishedVariant of ['agent:idle', 'agent:reportToParent'] as const) {
          for (const labelLength of ['short', 'long'] as const) {
            await component.update({
              props: {
                panelId: 'geometry',
                theme,
                width,
                zoom,
                finishedVariant,
                labelLength,
              },
            });
            const summaryLength = (await summary.textContent())!.length;
            if (labelLength === 'long') expect(summaryLength).toBeGreaterThan(50);
            else expect(summaryLength).toBeLessThan(50);
            for (const expanded of [false, true]) {
              if ((await summary.getAttribute('aria-expanded')) !== String(expanded)) {
                await summary.click();
                await page.waitForTimeout(180);
              }
              await expect(component.getByTestId('event-wakeup-card')).toBeVisible();
              await expect(component.getByTestId('following-transcript-row')).toBeVisible();
              const measurement = await component.evaluate((root) => {
                const card = root
                  .querySelector('[data-testid="event-wakeup-card"]')!
                  .getBoundingClientRect();
                const nextRow = root
                  .querySelector('[data-testid="following-transcript-row"]')!
                  .getBoundingClientRect();
                const sent = getComputedStyle(root.querySelector('[data-testid="sent-card"]')!);
                const finished = getComputedStyle(
                  root.querySelector('[data-testid="event-wakeup-header"]')!,
                );
                return {
                  cardBottom: card.bottom,
                  nextRowTop: nextRow.top,
                  sentInset: [sent.paddingInlineStart, sent.paddingBlockStart],
                  finishedInset: [finished.paddingInlineStart, finished.paddingBlockStart],
                };
              });
              expect(measurement.finishedInset).toEqual(measurement.sentInset);
              expect(measurement.nextRowTop - measurement.cardBottom).toBeCloseTo(48 * zoom, 1);
              measuredStates += 1;
            }
          }
        }
      }
    }
  }
  expect(measuredStates).toBe(64);
});

for (const theme of ['light', 'dark'] as const) {
  test(`uses canonical primary user-message colors and readable content in ${theme} theme`, async ({
    mount,
  }) => {
    const component = await mount(ChatEventGeometryHost, {
      props: { panelId: `colors-${theme}`, theme },
    });
    await component.getByTestId('sticky-scroll').evaluate((node) => node.scrollTo(0, 330));
    await expect(component.getByTestId('pinned-user-prompt')).toBeVisible();

    const styles = await component.evaluate((root) => {
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
        primary: resolveToken('--primary', 'backgroundColor'),
        primaryForeground: resolveToken('--primary-foreground', 'color'),
        ordinaryBackground: style('[data-testid="sent-card"]').backgroundColor,
        pinnedBackground: style('[data-testid="pinned-user-prompt"]').backgroundColor,
        ordinaryText: style('[data-testid="ordinary-user-text"]').color,
        pinnedText: style('[data-testid="pinned-user-prompt-text"]').color,
        linkText: style('[data-testid="ordinary-user-link"]').color,
        codeText: style('[data-testid="ordinary-user-code"]').color,
        codeBackground: style('[data-testid="ordinary-user-code"]').backgroundColor,
        selectionBackground: style('[data-testid="pinned-user-prompt-text"]', '::selection')
          .backgroundColor,
        selectionText: style('[data-testid="pinned-user-prompt-text"]', '::selection').color,
      };
    });

    expect(styles.ordinaryBackground).toBe(styles.primary);
    expect(styles.pinnedBackground).toBe(styles.primary);
    expect(styles.ordinaryText).toBe(styles.primaryForeground);
    expect(styles.pinnedText).toBe(styles.primaryForeground);
    expect(styles.linkText).toBe(styles.primaryForeground);
    expect(styles.codeText).toBe(styles.primaryForeground);
    expect(styles.codeBackground).not.toBe('rgba(0, 0, 0, 0)');
    expect(contrastRatio(styles.pinnedText, styles.pinnedBackground)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(styles.linkText, styles.ordinaryBackground)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(styles.codeText, styles.ordinaryBackground)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(styles.selectionText, styles.selectionBackground)).toBeGreaterThanOrEqual(
      4.5,
    );
  });
}

for (const chiefVariant of [false, true]) {
  test(`aligns the pinned bubble with in-conversation bubbles across the scrollbar gutter (chiefVariant=${chiefVariant})`, async ({
    mount,
  }) => {
    const component = await mount(ChatEventGeometryHost, {
      props: { panelId: `align-${chiefVariant}`, chiefVariant },
    });
    await component.getByTestId('sticky-scroll').evaluate((node) => node.scrollTo(0, 330));
    await expect(component.getByTestId('pinned-user-prompt')).toBeVisible();

    const geometry = await component.evaluate((root) => {
      const rect = (selector: string) => {
        const { left, right, width } = root.querySelector(selector)!.getBoundingClientRect();
        return { left, right, width };
      };
      const scroll = root.querySelector('[data-testid="sticky-scroll"]') as HTMLElement;
      return {
        gutter: scroll.offsetWidth - scroll.clientWidth,
        lane: rect('[data-testid="pinned-prompt-overlay-lane"]'),
        column: rect('[data-testid="conversation-column"]'),
        pinned: rect('[data-testid="pinned-user-prompt"]'),
        bubble: rect('[data-testid="in-conversation-user-bubble"]'),
      };
    });

    expect(geometry.gutter).toBeGreaterThan(0);
    expect(geometry.lane.left).toBeCloseTo(geometry.column.left, 1);
    expect(geometry.lane.width).toBeCloseTo(geometry.column.width, 1);
    expect(geometry.pinned.left).toBeCloseTo(geometry.bubble.left, 1);
    expect(geometry.pinned.right).toBeCloseTo(geometry.bubble.right, 1);
  });
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

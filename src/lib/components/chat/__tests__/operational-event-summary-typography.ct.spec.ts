import { expect, test, type Locator } from '@playwright/experimental-ct-svelte';
import AgentSubscriptionInlineHost from './AgentSubscriptionInlineHost.svelte';
import ChatEventGeometryHost from './ChatEventGeometryHost.svelte';

type SummaryStyle = {
  fontSize: string;
  lineHeight: string;
  fontWeight: string;
  color: string;
  opacity: string;
  mutedToken: string;
};

async function expectThemeSettled(host: Locator, theme: 'light' | 'dark') {
  const dark = theme === 'dark';
  await expect.poll(() => host.evaluate((node) => node.classList.contains('dark'))).toBe(dark);
}

async function expectCanonicalSummaries(host: Locator, selectors: string[]) {
  const result = await host.evaluate((root, requested) => {
    const probe = document.createElement('span');
    probe.className = 'type-body font-normal text-muted-foreground';
    root.append(probe);
    const read = (node: Element) => {
      const style = getComputedStyle(node);
      return {
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        fontWeight: style.fontWeight,
        color: style.color,
        opacity: style.opacity,
        mutedToken: style.getPropertyValue('--muted-foreground').trim(),
      };
    };
    const canonical = read(probe);
    probe.remove();
    return {
      canonical,
      values: requested.flatMap((selector) =>
        Array.from(root.querySelectorAll(selector), (node) => ({
          selector,
          style: read(node),
          className: node.getAttribute('class'),
          parentClassName: node.parentElement?.getAttribute('class'),
        })),
      ),
    };
  }, selectors);
  expect(result.values.length).toBeGreaterThan(0);
  for (const value of result.values as {
    selector: string;
    style: SummaryStyle;
    className: string | null;
    parentClassName: string | null | undefined;
  }[]) {
    expect(
      value.style,
      `${value.selector} (${value.className}; parent: ${value.parentClassName})`,
    ).toEqual(result.canonical);
  }
}

async function expectChevronGlyphs(host: Locator, selectors: string[], zoom: number) {
  const sizes = await host.evaluate(
    (root, requested) =>
      requested.map((selector) => {
        const target = root.querySelector(selector) as HTMLElement;
        const glyph = target.querySelector('svg') as SVGElement;
        const targetBox = target.getBoundingClientRect();
        const glyphStyle = getComputedStyle(glyph);
        return {
          selector,
          target: [targetBox.width, targetBox.height],
          glyphCss: [Number.parseFloat(glyphStyle.width), Number.parseFloat(glyphStyle.height)],
          glyphClass: glyph.getAttribute('class'),
        };
      }),
    selectors,
  );
  for (const size of sizes) {
    const label = `${size.selector} (${size.glyphClass})`;
    expect(size.glyphCss[0], label).toBeCloseTo(16, 1);
    expect(size.glyphCss[1], label).toBeCloseTo(16, 1);
    expect(size.target[0], label).toBeGreaterThanOrEqual(24 * zoom);
    expect(size.target[1], label).toBeGreaterThanOrEqual(24 * zoom);
  }
}

test('keeps finished, sent, started, and completed event summaries canonical', async ({
  mount,
}) => {
  const component = await mount(ChatEventGeometryHost, { props: { panelId: 'summary-tone' } });
  for (const theme of ['light', 'dark'] as const) {
    for (const width of [360, 960]) {
      for (const zoom of [1, 2]) {
        for (const finishedVariant of [
          'agent:idle',
          'agent:reportToParent',
          'agent:created',
          'agent:completed',
        ] as const) {
          await component.update({
            props: {
              panelId: 'summary-tone',
              theme,
              width,
              zoom,
              finishedVariant,
              labelLength: 'long',
            },
          });
          await expectThemeSettled(component, theme);
          const eventToggle = component.getByTestId('event-wakeup-summary');
          const sentToggle = component.getByTestId('agent-message-disclosure-toggle');
          for (const expanded of [false, true]) {
            for (const toggle of [eventToggle, sentToggle]) {
              if ((await toggle.getAttribute('aria-expanded')) !== String(expanded)) {
                await toggle.click();
              }
            }
            await expectCanonicalSummaries(component, [
              '[data-testid="event-wakeup-summary"] strong',
              '[data-testid="event-wakeup-summary"] > span[title]',
              '[data-testid="event-wakeup-status"]',
              '[data-testid="agent-message-attribution"] > span[title]',
              '[data-testid="agent-message-disclosure-toggle"] > span:not([data-testid])',
              '[data-testid="agent-message-preview"]',
            ]);
            await expectChevronGlyphs(
              component,
              [
                '[data-testid="event-wakeup-chevron-column"]',
                '[data-testid="agent-message-chevron-column"]',
              ],
              zoom,
            );
            expect((await eventToggle.getAttribute('aria-label'))?.length).toBeGreaterThan(50);
            expect((await sentToggle.getAttribute('aria-label'))?.length).toBeGreaterThan(50);
            expect(
              await component
                .getByTestId('event-wakeup-card')
                .evaluate((node) => node.scrollWidth <= node.clientWidth),
            ).toBe(true);
          }
        }
      }
    }
  }
});

test('keeps waiting, finished, peer, and inline-agent summaries canonical', async ({ mount }) => {
  const component = await mount(AgentSubscriptionInlineHost, {
    props: { mode: 'mixed', agentCount: 7, finishedCount: 2, initiallyExpanded: true },
  });
  for (const theme of ['light', 'dark'] as const) {
    for (const width of [280, 720]) {
      for (const zoom of [1, 2]) {
        await component.update({
          props: {
            mode: 'mixed',
            agentCount: 7,
            finishedCount: 2,
            initiallyExpanded: true,
            longLabels: true,
            theme,
            width,
            zoom,
          },
        });
        await expectThemeSettled(component, theme);
        const outer = component.getByTestId('event-subscriptions-summary');
        if ((await outer.getAttribute('aria-expanded')) === 'false') await outer.click();
        const waiting = component.getByTestId('one-shot-summary-toggle');
        if ((await waiting.getAttribute('aria-expanded')) === 'false') await waiting.click();
        const finished = component.getByTestId('finished-agent-summary');
        await expectCanonicalSummaries(component, [
          '[data-testid="event-subscriptions-summary-title"]',
          '[data-testid="one-shot-summary-title"]',
          '[data-testid="finished-agent-summary-title"]',
        ]);
        await expectChevronGlyphs(
          component,
          [
            '[data-testid="event-subscriptions-chevron"]',
            '[data-testid="one-shot-collapse-toggle"]',
            '[data-testid="finished-agent-chevron"]',
          ],
          zoom,
        );
        for (const toggle of [finished, waiting, outer]) {
          const before = await toggle.getAttribute('aria-expanded');
          await toggle.click();
          expect(await toggle.getAttribute('aria-expanded')).not.toBe(before);
          await toggle.click();
          expect(await toggle.getAttribute('aria-expanded')).toBe(before);
        }
        expect(await component.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      }
    }
  }
});

import { expect, test, type Locator, type Page } from '@playwright/experimental-ct-svelte';
import AgentSubscriptionInlineHost from './AgentSubscriptionInlineHost.svelte';

const toolKinds = ['file', 'terminal', 'tool'] as const;

async function measure(component: Locator, page: Page) {
  await expect(component.getByTestId('agent-card-preview')).toBeVisible();
  await expect(component.getByTestId('agent-card-trailing-slot').locator('[title]')).toHaveCount(1);
  await page.waitForFunction(() => {
    const text = document.querySelector('[data-testid="agent-preview-tool-text"]');
    return !text || (text.textContent?.trim().length ?? 0) > 0;
  });
  return component.evaluate((root) => {
    const element = (testId: string) =>
      root.querySelector(`[data-testid="${testId}"]`) as HTMLElement;
    const preview = element('agent-card-preview');
    const toolText = root.querySelector(
      '[data-testid="agent-preview-tool-text"]',
    ) as HTMLElement | null;
    const name = element('agent-card-name');
    const timestamp = element('agent-card-trailing-slot').querySelector('[title]') as HTMLElement;
    const row = element('agent-list-item').querySelector('button') as HTMLElement;
    const header = element('one-shot-header');
    const rows = Array.from(root.querySelectorAll('[data-testid="agent-list-item"] button'));
    const rect = (node: Element) => {
      const value = node.getBoundingClientRect();
      return {
        top: value.top,
        right: value.right,
        bottom: value.bottom,
        left: value.left,
        width: value.width,
        height: value.height,
      };
    };
    const textStyle = (node: Element) => {
      const style = getComputedStyle(node);
      return { color: style.color, opacity: style.opacity, fontWeight: style.fontWeight };
    };
    const geometryStyle = (node: Element) => {
      const style = getComputedStyle(node);
      return {
        paddingInlineStart: style.paddingInlineStart,
        paddingInlineEnd: style.paddingInlineEnd,
        paddingBlockStart: style.paddingBlockStart,
        paddingBlockEnd: style.paddingBlockEnd,
        minHeight: style.minHeight,
      };
    };
    return {
      nameStyle: textStyle(name),
      previewStyle: textStyle(toolText ?? preview),
      timestampStyle: textStyle(timestamp),
      rowGeometry: geometryStyle(row),
      headerGeometry: geometryStyle(header),
      rowHeights: rows.map((current) => rect(current).height),
      headerHeight: rect(header).height,
      nameRect: rect(name),
      previewRect: rect(preview),
      toolTextRect: toolText ? rect(toolText) : null,
      timestampRect: rect(timestamp),
      trailingStyle: {
        width: getComputedStyle(element('agent-card-trailing-slot')).width,
        flexShrink: getComputedStyle(element('agent-card-trailing-slot')).flexShrink,
      },
      timestampTextAlign: getComputedStyle(timestamp).textAlign,
      timestampNumeric: getComputedStyle(timestamp).fontVariantNumeric,
      previewOverflow: {
        clientWidth: (toolText ?? preview).clientWidth,
        scrollWidth: (toolText ?? preview).scrollWidth,
        overflowX: getComputedStyle(toolText ?? preview).overflowX,
        whiteSpace: getComputedStyle(toolText ?? preview).whiteSpace,
        textOverflow: getComputedStyle(toolText ?? preview).textOverflow,
      },
      cleanText: (toolText ?? preview).textContent?.trim() ?? '',
      cleanTitle: (toolText?.parentElement ?? preview).getAttribute('title') ?? '',
      interactiveCount: preview.querySelectorAll('a, button, input, [tabindex]').length,
      peekIconCount: preview.querySelectorAll('svg, .agent-preview-tool-icon').length,
      peekAriaLabelCount: preview.querySelectorAll('[aria-label]').length,
      rowOverflow: row.scrollWidth - row.clientWidth,
    };
  });
}

test('keeps peek text and timestamp on the shared secondary primitive', async ({ mount, page }) => {
  const component = await mount(AgentSubscriptionInlineHost);
  for (const theme of ['light', 'dark'] as const) {
    for (const zoom of [1, 2]) {
      for (const previewKind of toolKinds) {
        await component.update({ props: { theme, zoom, width: 340, previewKind } });
        for (const interaction of ['rest', 'hover', 'focus'] as const) {
          const row = component.getByTestId('agent-list-item').first().locator('button');
          if (interaction === 'hover') await row.hover();
          if (interaction === 'focus') await row.focus();
          if (interaction === 'rest') {
            await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
            await page.mouse.move(0, 0);
            await expect(
              component.getByTestId('agent-card-trailing-slot').locator('[title]'),
            ).toHaveCSS('opacity', '1');
          }
          const value = await measure(component, page);
          expect(value.nameStyle.fontWeight).toBe('400');
          expect(value.previewStyle.fontWeight).toBe('400');
          expect(value.timestampStyle.fontWeight).toBe('400');
          if (interaction === 'rest') expect(value.previewStyle).toEqual(value.timestampStyle);
          expect(value.peekIconCount).toBe(0);
          expect(value.peekAriaLabelCount).toBe(0);
          expect(value.nameStyle.color).not.toBe(value.previewStyle.color);
        }
      }
    }
  }
});

test('cleans Markdown and keeps one true ellipsis region clear of the timestamp', async ({
  mount,
  page,
}) => {
  const component = await mount(AgentSubscriptionInlineHost);
  for (const previewKind of [...toolKinds, 'text'] as const) {
    for (const zoom of [1, 2]) {
      await component.update({ props: { previewKind, width: 270, zoom } });
      const value = await measure(component, page);
      expect(value.cleanText).not.toMatch(/[`*_\[\]]/);
      expect(value.cleanTitle).toBe(value.cleanText);
      expect(value.interactiveCount).toBe(0);
      expect(value.previewOverflow.scrollWidth).toBeGreaterThanOrEqual(
        value.previewOverflow.clientWidth,
      );
      if (previewKind === 'text') {
        expect(value.previewOverflow.scrollWidth).toBeGreaterThan(
          value.previewOverflow.clientWidth,
        );
      }
      expect(value.previewOverflow.whiteSpace).toBe('nowrap');
      expect(value.previewOverflow.textOverflow).toBe('ellipsis');
      expect(value.previewRect.right).toBeLessThanOrEqual(value.timestampRect.left + 0.5);
      expect(value.rowOverflow).toBeLessThanOrEqual(0);
      expect(value.trailingStyle.width).toBe('56px');
      expect(value.trailingStyle.flexShrink).toBe('0');
      expect(value.timestampTextAlign).toBe('right');
      expect(value.timestampNumeric).toContain('tabular-nums');
      expect(value.peekIconCount).toBe(0);
      expect(value.peekAriaLabelCount).toBe(0);
    }
  }
});

test('starts every icon-free peek exactly 10px after the primary label', async ({
  mount,
  page,
}) => {
  const component = await mount(AgentSubscriptionInlineHost);
  for (const theme of ['light', 'dark'] as const) {
    for (const previewKind of [...toolKinds, 'text'] as const) {
      for (const width of [270, 340]) {
        for (const zoom of [1, 2]) {
          await component.update({ props: { theme, previewKind, width, zoom } });
          const value = await measure(component, page);
          const peekLeft = value.toolTextRect?.left ?? value.previewRect.left;
          expect(value.peekIconCount).toBe(0);
          expect(value.peekAriaLabelCount).toBe(0);
          expect(peekLeft - value.nameRect.right).toBeCloseTo(10 * zoom, 1);
        }
      }
    }
  }
});

test('shares exact header and agent-row padding and minimum height', async ({ mount, page }) => {
  const component = await mount(AgentSubscriptionInlineHost);
  for (const width of [270, 340]) {
    for (const zoom of [1, 2]) {
      await component.update({ props: { mode: 'agents', width, zoom } });
      const value = await measure(component, page);
      expect(value.rowGeometry).toEqual(value.headerGeometry);
      expect(value.rowGeometry).toEqual({
        paddingInlineStart: '12px',
        paddingInlineEnd: '12px',
        paddingBlockStart: '8px',
        paddingBlockEnd: '8px',
        minHeight: '36px',
      });
      expect(value.headerHeight).toBeCloseTo(36 * zoom, 1);
      for (const height of value.rowHeights) expect(height).toBeCloseTo(36 * zoom, 1);
    }
  }
});

test('renders exactly one promoted Waiting disclosure in agent-only mode', async ({ mount }) => {
  const component = await mount(AgentSubscriptionInlineHost, { props: { mode: 'agents' } });
  await expect(component.getByTestId('event-subscriptions-outer-header')).toHaveCount(0);
  await expect(component.getByTestId('event-subscriptions-summary')).toHaveCount(0);
  await expect(component.getByTestId('one-shot-summary-toggle')).toHaveCount(1);
  await expect(component.getByText('Waiting for 7 agents', { exact: true })).toHaveCount(1);
});

test('keeps the outer Subscribed header and a distinct cohort header in mixed mode', async ({
  mount,
}) => {
  const component = await mount(AgentSubscriptionInlineHost, { props: { mode: 'mixed' } });
  await expect(component.getByTestId('event-subscriptions-outer-header')).toHaveCount(1);
  await expect(component.getByRole('button', { name: 'Subscribed to 8 events' })).toHaveCount(1);
  await expect(component.getByText('Waiting for 7 agents', { exact: true })).toHaveCount(1);
  await expect(component.getByTestId('mixed-subscription-preview')).toBeVisible();
});

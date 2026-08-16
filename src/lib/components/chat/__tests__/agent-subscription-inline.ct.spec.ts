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

test('aligns the foreground waiting header to the standard avatar grid', async ({ mount }) => {
  const component = await mount(AgentSubscriptionInlineHost);
  const cases = [
    { agentCount: 1, longLabels: true },
    { agentCount: 7, longLabels: false },
  ] as const;

  for (const theme of ['light', 'dark'] as const) {
    for (const width of [270, 340]) {
      for (const zoom of [1, 2]) {
        for (const current of cases) {
          await component.update({ props: { theme, width, zoom, ...current } });
          const summary = component.getByTestId('one-shot-summary-toggle');
          if ((await summary.getAttribute('aria-expanded')) === 'false') await summary.click();
          await expect(component.getByTestId('agent-list-item')).toHaveCount(current.agentCount);

          const expanded = await component.evaluate((root) => {
            const element = (testId: string) =>
              root.querySelector(`[data-testid="${testId}"]`) as HTMLElement;
            const rect = (node: Element) => {
              const box = node.getBoundingClientRect();
              return {
                left: box.left,
                right: box.right,
                top: box.top,
                bottom: box.bottom,
                centerX: (box.left + box.right) / 2,
                centerY: (box.top + box.bottom) / 2,
              };
            };
            const icon = element('one-shot-leading-column').querySelector('svg')!;
            const title = element('one-shot-summary-title');
            const avatar = element('agent-card-avatar-wrapper');
            const name = element('agent-card-name');
            const headerRow = element('one-shot-header');
            const agentRow = element('agent-list-item').querySelector('button')!;
            return {
              slot: rect(element('one-shot-leading-column')),
              icon: rect(icon),
              avatar: rect(avatar),
              title: rect(title),
              name: rect(name),
              headerRow: rect(headerRow),
              agentRow: rect(agentRow),
              iconStyle: {
                color: getComputedStyle(icon).color,
                opacity: getComputedStyle(icon).opacity,
              },
              titleStyle: {
                color: getComputedStyle(title).color,
                opacity: getComputedStyle(title).opacity,
              },
              nameColor: getComputedStyle(name).color,
              devicePixelRatio: window.devicePixelRatio,
            };
          });

          const deviceDelta = (left: number, right: number) =>
            Math.abs(left - right) * expanded.devicePixelRatio;
          expect(deviceDelta(expanded.slot.centerX, expanded.avatar.centerX)).toBeLessThanOrEqual(
            0.5,
          );
          expect(
            deviceDelta(
              expanded.slot.centerY - expanded.headerRow.top,
              expanded.avatar.centerY - expanded.agentRow.top,
            ),
          ).toBeLessThanOrEqual(0.5);
          expect(deviceDelta(expanded.icon.centerX, expanded.avatar.centerX)).toBeLessThanOrEqual(
            0.5,
          );
          expect(
            deviceDelta(
              expanded.icon.centerY - expanded.headerRow.top,
              expanded.avatar.centerY - expanded.agentRow.top,
            ),
          ).toBeLessThanOrEqual(0.5);
          expect(deviceDelta(expanded.title.left, expanded.name.left)).toBeLessThanOrEqual(0.5);
          expect(expanded.iconStyle).toEqual({ color: expanded.nameColor, opacity: '1' });
          expect(expanded.titleStyle).toEqual({ color: expanded.nameColor, opacity: '1' });

          await summary.click();
          await expect(summary).toHaveAttribute('aria-expanded', 'false');
          await expect(component.getByTestId('one-shot-agent-list')).toHaveCount(0);
          const collapsed = await component
            .getByTestId('one-shot-leading-column')
            .evaluate((slot) => {
              const icon = slot.querySelector('svg')!;
              const slotBox = slot.getBoundingClientRect();
              const iconBox = icon.getBoundingClientRect();
              return {
                slotCenterX: (slotBox.left + slotBox.right) / 2,
                iconCenterX: (iconBox.left + iconBox.right) / 2,
                iconColor: getComputedStyle(icon).color,
                iconOpacity: getComputedStyle(icon).opacity,
                devicePixelRatio: window.devicePixelRatio,
              };
            });
          expect(
            Math.abs(collapsed.slotCenterX - collapsed.iconCenterX) * collapsed.devicePixelRatio,
          ).toBeLessThanOrEqual(0.5);
          expect(collapsed.iconColor).toBe(expanded.nameColor);
          expect(collapsed.iconOpacity).toBe('1');
        }
      }
    }
  }
});

test('keeps keyed waiting and finished rows stable through add, remove, reorder, and interruption', async ({
  mount,
  page,
}) => {
  const component = await mount(AgentSubscriptionInlineHost, {
    props: { agentCount: 7, finishedCount: 2 },
  });
  await component.getByTestId('agent-list-item').first().locator('button').focus();
  const focusedId = await page.evaluate(() =>
    document.activeElement
      ?.closest('[data-testid="agent-list-item"]')
      ?.getAttribute('data-agent-id'),
  );

  await component.update({ props: { agentCount: 7, finishedCount: 2, reverseAgents: true } });
  expect(
    await page.evaluate(() =>
      document.activeElement
        ?.closest('[data-testid="agent-list-item"]')
        ?.getAttribute('data-agent-id'),
    ),
  ).toBe(focusedId);

  await component.update({ props: { agentCount: 3, reverseAgents: true } });
  await component.update({ props: { agentCount: 9, reverseAgents: false } });
  await component.update({ props: { agentCount: 4, reverseAgents: true } });
  await page.waitForTimeout(220);

  const rows = component.locator('[data-subscription-motion-row]');
  await expect(rows).toHaveCount(4);
  expect(
    await rows.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-agent-id'))),
  ).toEqual([
    'agent-subscription-filler-3',
    'agent-subscription-filler-2',
    'agent-subscription-filler-1',
    'agent-subscription-inline-geometry',
  ]);
  expect(
    await component.getByTestId('one-shot-agent-list').evaluate((list) => ({
      height: list.getBoundingClientRect().height,
      rowHeight: Array.from(list.querySelectorAll('[data-subscription-motion-row]')).reduce(
        (total, row) => total + row.getBoundingClientRect().height,
        0,
      ),
    })),
  ).toEqual({ height: 144, rowHeight: 144 });
});

test('uses exact named standard avatar geometry in every subscription row', async ({ mount }) => {
  const component = await mount(AgentSubscriptionInlineHost);
  for (const theme of ['light', 'dark'] as const) {
    for (const width of [270, 340]) {
      for (const zoom of [1, 2]) {
        await component.update({ props: { theme, width, zoom } });
        const value = await component.evaluate((root) => {
          const row = root.querySelector('[data-testid="agent-list-item"] button')!;
          const wrapper = row.querySelector('[data-testid="agent-card-avatar-wrapper"]')!;
          const surface = wrapper.querySelector('[data-agent-avatar-surface]')!;
          const glyph = wrapper.querySelector('[data-agent-avatar]')!;
          const rect = (node: Element) => {
            const box = node.getBoundingClientRect();
            return {
              width: box.width,
              height: box.height,
              centerX: (box.left + box.right) / 2,
              centerY: (box.top + box.bottom) / 2,
            };
          };
          const glyphStyle = getComputedStyle(glyph);
          return {
            boxes: [wrapper, surface, glyph].map(rect),
            row: rect(row),
            variants: [surface, glyph].map((node) => node.getAttribute('data-avatar-variant')),
            inlineSizes: [surface, glyph].map((node) => ({
              width: (node as HTMLElement).style.width,
              height: (node as HTMLElement).style.height,
            })),
            radii: [wrapper, surface, glyph].map((node) => getComputedStyle(node).borderRadius),
            ringRadius: getComputedStyle(surface, '::after').borderRadius,
            clearSpace: Number.parseFloat(glyphStyle.paddingInlineStart),
            artWidth:
              (glyph as HTMLElement).clientWidth -
              Number.parseFloat(glyphStyle.paddingInlineStart) -
              Number.parseFloat(glyphStyle.paddingInlineEnd),
            devicePixelRatio: window.devicePixelRatio,
          };
        });

        expect(value.variants).toEqual(['standard', 'standard']);
        expect(value.inlineSizes).toEqual([
          { width: '', height: '' },
          { width: '', height: '' },
        ]);
        for (const box of value.boxes) {
          expect(box.width).toBeCloseTo(20 * zoom, 1);
          expect(box.height).toBeCloseTo(20 * zoom, 1);
          expect(
            Math.abs(box.centerX - value.boxes[1].centerX) * value.devicePixelRatio,
          ).toBeLessThanOrEqual(0.5);
          expect(
            Math.abs(box.centerY - value.boxes[1].centerY) * value.devicePixelRatio,
          ).toBeLessThanOrEqual(0.5);
        }
        expect(value.radii).toEqual(['6px', '6px', '6px']);
        expect(value.ringRadius).toBe('6px');
        expect(value.clearSpace).toBe(2);
        expect(value.artWidth).toBe(16);
        expect(
          Math.abs(value.boxes[0].centerY - value.row.centerY) * value.devicePixelRatio,
        ).toBeLessThanOrEqual(0.5);
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

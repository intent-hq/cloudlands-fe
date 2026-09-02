import { expect, test, type Locator, type Page } from '@playwright/experimental-ct-svelte';
import AgentSubscriptionInlineHost from './AgentSubscriptionInlineHost.svelte';

const toolKinds = ['file', 'terminal', 'tool'] as const;

test.afterEach(async ({ page }) => {
  await page.locator('#root').evaluate(async (root) => {
    if (root.childElementCount > 0) await window.playwrightUnmount(root);
  });
});

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
    const header = element('one-shot-summary-toggle');
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
          expect(value.nameStyle.color).toBe(value.previewStyle.color);
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
      if (previewKind === 'text') {
        await expect
          .poll(() =>
            component
              .getByTestId('agent-card-preview')
              .evaluate((node) => node.scrollWidth - node.clientWidth),
          )
          .toBeGreaterThan(0);
      }
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

test('keeps the waiting icon at the compact gap and on the header text tone', async ({ mount }) => {
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
                width: box.width,
                height: box.height,
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
          expect(expanded.slot.width).toBeCloseTo(20 * zoom, 1);
          expect(expanded.slot.height).toBeCloseTo(20 * zoom, 1);
          expect(deviceDelta(expanded.slot.left, expanded.avatar.left)).toBeLessThanOrEqual(0.5);
          expect(deviceDelta(expanded.slot.centerX, expanded.icon.centerX)).toBeLessThanOrEqual(
            0.5,
          );
          expect(
            deviceDelta(
              expanded.slot.centerY - expanded.headerRow.top,
              expanded.avatar.centerY - expanded.agentRow.top,
            ),
          ).toBeLessThanOrEqual(0.5);
          expect(
            deviceDelta(
              expanded.icon.centerY - expanded.headerRow.top,
              expanded.avatar.centerY - expanded.agentRow.top,
            ),
          ).toBeLessThanOrEqual(0.5);
          expect(expanded.title.left - expanded.slot.right).toBeCloseTo(8 * zoom, 1);
          expect(deviceDelta(expanded.title.left, expanded.name.left)).toBeLessThanOrEqual(0.5);
          // All summary labels share one opaque muted tone; avatars retain semantic colors.
          expect(expanded.iconStyle.opacity).toBe('1');
          expect(expanded.iconStyle.color).toBe(expanded.titleStyle.color);
          expect(expanded.titleStyle.opacity).toBe('1');
          expect(expanded.titleStyle.color).toBe(expanded.nameColor);

          await summary.click();
          await expect(summary).toHaveAttribute('aria-expanded', 'false');
          await expect(component.getByTestId('one-shot-agent-list')).toHaveCount(0);
          await expect(component.getByTestId('one-shot-leading-column').locator('svg')).toHaveCount(
            1,
          );
          await expect(
            component.getByTestId('one-shot-header').locator('[data-agent-avatar-stack]'),
          ).toHaveCount(1);
          const collapsedTitleLeft = await component
            .getByTestId('one-shot-summary-title')
            .evaluate((title) => title.getBoundingClientRect().left);
          expect(
            Math.abs(collapsedTitleLeft - expanded.title.left) * expanded.devicePixelRatio,
          ).toBeLessThanOrEqual(0.5);
          const collapsedIcon = await component
            .getByTestId('one-shot-leading-column')
            .locator('svg')
            .evaluate((icon) => {
              const box = icon.getBoundingClientRect();
              return {
                centerX: (box.left + box.right) / 2,
                centerY: (box.top + box.bottom) / 2,
                color: getComputedStyle(icon).color,
                opacity: getComputedStyle(icon).opacity,
              };
            });
          expect(deviceDelta(collapsedIcon.centerX, expanded.icon.centerX)).toBeLessThanOrEqual(
            0.5,
          );
          expect(deviceDelta(collapsedIcon.centerY, expanded.icon.centerY)).toBeLessThanOrEqual(
            0.5,
          );
          expect(collapsedIcon.color).toBe(expanded.iconStyle.color);
          expect(collapsedIcon.opacity).toBe('1');
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
    document.activeElement?.closest('[data-agent-id]')?.getAttribute('data-agent-id'),
  );
  expect(focusedId).toBe('agent-subscription-inline-geometry');

  await component.update({ props: { agentCount: 7, finishedCount: 2, reverseAgents: true } });
  expect(
    await page.evaluate(() =>
      document.activeElement?.closest('[data-agent-id]')?.getAttribute('data-agent-id'),
    ),
  ).toBe(focusedId);

  await component.update({ props: { agentCount: 3, finishedCount: 0, reverseAgents: true } });
  await component.update({ props: { agentCount: 9, finishedCount: 0, reverseAgents: false } });
  await component.update({ props: { agentCount: 4, finishedCount: 0, reverseAgents: true } });
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
            pseudoContent: getComputedStyle(surface, '::after').content,
            pseudoWidth: getComputedStyle(surface, '::after').borderTopWidth,
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
        expect(value.pseudoContent).toBe('none');
        expect(value.pseudoWidth).toBe('0px');
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

test('omits cohort time and pins the finished chevron across count and state', async ({
  mount,
}) => {
  const component = await mount(AgentSubscriptionInlineHost, {
    props: { mode: 'agents', agentCount: 7, finishedCount: 2, initiallyExpanded: true },
  });
  for (const theme of ['light', 'dark'] as const) {
    for (const width of [270, 420]) {
      for (const zoom of [1, 2]) {
        let expectedRight: number | undefined;
        for (const finishedCount of [2, 5]) {
          await component.update({
            props: {
              mode: 'agents',
              agentCount: 7,
              finishedCount,
              initiallyExpanded: true,
              theme,
              width,
              zoom,
            },
          });
          const waitingSummary = component.getByTestId('one-shot-summary-toggle');
          if ((await waitingSummary.getAttribute('aria-expanded')) === 'false') {
            await waitingSummary.click();
          }
          const summary = component.getByTestId('finished-agent-summary');
          if ((await summary.getAttribute('aria-expanded')) === 'true') await summary.click();
          await expect(summary).toHaveText(`${finishedCount} agents finished`);
          await expect(
            summary.locator('time, [title], [data-finished-at], [role="tooltip"]'),
          ).toHaveCount(0);
          await expect(component.getByTestId('finished-agent-group')).not.toHaveAttribute(
            'data-finished-at',
          );
          await expect(
            component.getByTestId('finished-agent-chevron').locator('[data-icon="chevron-down"]'),
          ).toHaveClass(/rotate-90/);

          const collapsed = await summary.evaluate((row) => {
            const slot = row.querySelector('[data-testid="finished-agent-chevron"]') as HTMLElement;
            const rowBox = row.getBoundingClientRect();
            const slotBox = slot.getBoundingClientRect();
            return {
              rowRight: rowBox.right,
              rowCenterY: (rowBox.top + rowBox.bottom) / 2,
              slotRight: slotBox.right,
              slotCenterY: (slotBox.top + slotBox.bottom) / 2,
              slotWidth: slotBox.width,
              slotHeight: slotBox.height,
              devicePixelRatio: window.devicePixelRatio,
            };
          });
          expectedRight ??= collapsed.slotRight;
          expect(
            Math.abs(collapsed.slotRight - expectedRight) * collapsed.devicePixelRatio,
          ).toBeLessThanOrEqual(0.5);
          expect(collapsed.rowRight - collapsed.slotRight).toBeCloseTo(12 * zoom, 1);
          expect(collapsed.slotWidth).toBeCloseTo(24 * zoom, 1);
          expect(collapsed.slotHeight).toBeCloseTo(24 * zoom, 1);
          expect(
            Math.abs(collapsed.slotCenterY - collapsed.rowCenterY) * collapsed.devicePixelRatio,
          ).toBeLessThanOrEqual(0.5);

          await summary.click();
          await expect(summary).toHaveAttribute('aria-expanded', 'true');
          await expect(
            component.getByTestId('finished-agent-chevron').locator('[data-icon="chevron-down"]'),
          ).not.toHaveClass(/rotate-90/);
          const expandedRight = await component
            .getByTestId('finished-agent-chevron')
            .evaluate((slot) => slot.getBoundingClientRect().right);
          expect(
            Math.abs(expandedRight - collapsed.slotRight) * collapsed.devicePixelRatio,
          ).toBeLessThanOrEqual(0.5);
        }
      }
    }
  }
});

test('centers the finished summary and gives completed avatars a muted semantic surface', async ({
  mount,
}) => {
  const component = await mount(AgentSubscriptionInlineHost, {
    props: { mode: 'agents', agentCount: 7, finishedCount: 2, initiallyExpanded: true },
  });

  for (const theme of ['light', 'dark'] as const) {
    for (const width of [270, 420]) {
      for (const zoom of [1, 2]) {
        await component.update({
          props: {
            mode: 'agents',
            agentCount: 7,
            finishedCount: 2,
            initiallyExpanded: true,
            theme,
            width,
            zoom,
          },
        });
        const waitingSummary = component.getByTestId('one-shot-summary-toggle');
        if ((await waitingSummary.getAttribute('aria-expanded')) === 'false') {
          await waitingSummary.click();
        }
        const summary = component.getByTestId('finished-agent-summary');
        if ((await summary.getAttribute('aria-expanded')) === 'true') await summary.click();

        const geometry = await summary.evaluate((row) => {
          const icon = row.querySelector('[data-icon="circle-check"]') as SVGElement;
          const title = row.querySelector(
            '[data-testid="finished-agent-summary-title"]',
          ) as HTMLElement;
          const rowBox = row.getBoundingClientRect();
          const iconBox = icon.getBoundingClientRect();
          const titleBox = title.getBoundingClientRect();
          const contentTop = Math.min(iconBox.top, titleBox.top);
          const contentBottom = Math.max(iconBox.bottom, titleBox.bottom);
          const style = getComputedStyle(row);
          return {
            paddingTop: style.paddingTop,
            paddingBottom: style.paddingBottom,
            topGap: contentTop - rowBox.top,
            bottomGap: rowBox.bottom - contentBottom,
            rowCenterY: (rowBox.top + rowBox.bottom) / 2,
            iconCenterY: (iconBox.top + iconBox.bottom) / 2,
            titleCenterY: (titleBox.top + titleBox.bottom) / 2,
            iconWidth: iconBox.width,
            iconHeight: iconBox.height,
            devicePixelRatio: window.devicePixelRatio,
          };
        });
        expect(geometry.paddingTop).toBe('8px');
        expect(geometry.paddingBottom).toBe('8px');
        expect(
          Math.abs(geometry.topGap - geometry.bottomGap) * geometry.devicePixelRatio,
        ).toBeLessThanOrEqual(0.5);
        expect(
          Math.abs(geometry.iconCenterY - geometry.rowCenterY) * geometry.devicePixelRatio,
        ).toBeLessThanOrEqual(0.5);
        expect(
          Math.abs(geometry.titleCenterY - geometry.rowCenterY) * geometry.devicePixelRatio,
        ).toBeLessThanOrEqual(0.5);
        expect(geometry.iconWidth).toBeCloseTo(14 * zoom, 1);
        expect(geometry.iconHeight).toBeCloseTo(14 * zoom, 1);

        await summary.click();
        const completed = component
          .getByTestId('finished-agent-list')
          .locator('[data-agent-avatar-with-state]')
          .first();
        await expect(completed).toHaveAttribute('data-avatar-state', 'completed');
        await expect(completed.locator('[data-avatar-overlay], [data-icon]')).toHaveCount(0);
        const colors = await completed.evaluate((avatar) => {
          const parseRgb = (value: string) =>
            (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number) as [number, number, number];
          const luminance = ([red, green, blue]: [number, number, number]) => {
            const channel = (value: number) => {
              const normalized = value / 255;
              return normalized <= 0.04045
                ? normalized / 12.92
                : ((normalized + 0.055) / 1.055) ** 2.4;
            };
            return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
          };
          const contrast = (first: string, second: string) => {
            const values = [luminance(parseRgb(first)), luminance(parseRgb(second))].sort(
              (left, right) => right - left,
            );
            return (values[0] + 0.05) / (values[1] + 0.05);
          };
          const chroma = (value: string) => {
            const channels = parseRgb(value);
            return Math.max(...channels) - Math.min(...channels);
          };
          const resolveBackground = (variable: string) => {
            const probe = document.createElement('span');
            probe.style.backgroundColor = `hsl(var(${variable}))`;
            avatar.append(probe);
            const value = getComputedStyle(probe).backgroundColor;
            probe.remove();
            return value;
          };
          const avatarStyle = getComputedStyle(avatar);
          const card = avatar.closest('[data-testid="agent-subscriptions-card"]') as HTMLElement;
          const cardBackground = getComputedStyle(card).backgroundColor;
          const icon = card.querySelector('[data-icon="circle-check"]') as SVGElement;
          const title = card.querySelector(
            '[data-testid="finished-agent-summary-title"]',
          ) as HTMLElement;
          const completedBackground = avatarStyle.backgroundColor;
          const completedForeground = avatarStyle.color;
          const avatarArt = avatar.querySelector('[data-agent-avatar]') as SVGElement;
          const avatarArtStyle = getComputedStyle(avatarArt);
          const parentStyle = getComputedStyle(avatar.parentElement!);
          const activeBackground = resolveBackground('--agent-avatar-surface-active');
          const waitingBackground = resolveBackground('--agent-avatar-surface-waiting');
          return {
            design: avatar.querySelector('[data-agent-avatar]')?.getAttribute('data-avatar-design'),
            completedBackground,
            completedForeground,
            avatarOpacity: avatarStyle.opacity,
            avatarArtColor: avatarArtStyle.color,
            avatarArtOpacity: avatarArtStyle.opacity,
            parentOpacity: parentStyle.opacity,
            parentColor: parentStyle.color,
            cardBackground,
            cardOpacity: getComputedStyle(card).opacity,
            activeAnimations: avatar.getAnimations().map((animation) => ({
              playState: animation.playState,
              progress: animation.effect?.getComputedTiming().progress,
              duration: animation.effect?.getComputedTiming().duration,
            })),
            activeBackground,
            waitingBackground,
            completedContrast: contrast(completedForeground, completedBackground),
            iconColor: getComputedStyle(icon).color,
            iconOpacity: getComputedStyle(icon).opacity,
            titleColor: getComputedStyle(title).color,
            titleOpacity: getComputedStyle(title).opacity,
            completedChroma: chroma(completedBackground),
            activeChroma: chroma(activeBackground),
            waitingChroma: chroma(waitingBackground),
          };
        });
        expect(colors.design).toBeTruthy();
        expect(colors.completedBackground).not.toBe(colors.activeBackground);
        expect(colors.completedBackground).not.toBe(colors.waitingBackground);
        expect(colors.avatarOpacity).toBe('1');
        expect(colors.avatarArtOpacity).toBe('1');
        expect(colors.parentOpacity).toBe('1');
        expect(colors.cardOpacity).toBe('1');
        expect(colors.avatarArtColor).toBe(colors.completedForeground);
        expect(colors.activeAnimations).toEqual([]);
        expect(colors.completedContrast, JSON.stringify(colors)).toBeGreaterThanOrEqual(4.5);
        expect(colors.iconColor).toBe(colors.titleColor);
        expect(colors.iconOpacity).toBe(colors.titleOpacity);
        expect(colors.completedChroma).toBeLessThan(colors.activeChroma);
        expect(colors.completedChroma).toBeLessThan(colors.waitingChroma);
      }
    }
  }
});

test('screenshots the finished summary and completed participant treatment', async ({
  mount,
  page,
}) => {
  /* The host fixture pins agent timestamps to 2026-08-15, but the compact
     relative-time label ("2d", "2w", …) is computed from the real clock, so
     the rendered text — and the screenshot — drifts as calendar time moves
     past the fixture dates. Pin the clock 2 days after the fixture timestamps
     to match the committed baselines. */
  await page.clock.setFixedTime(new Date('2026-08-17T12:05:00.000Z'));
  const component = await mount(AgentSubscriptionInlineHost, {
    props: { mode: 'agents', agentCount: 7, finishedCount: 2, initiallyExpanded: true },
  });
  for (const theme of ['light', 'dark'] as const) {
    for (const zoom of [1, 2]) {
      await component.update({
        props: {
          mode: 'agents',
          agentCount: 7,
          finishedCount: 2,
          initiallyExpanded: true,
          theme,
          width: 420,
          zoom,
        },
      });
      const waitingSummary = component.getByTestId('one-shot-summary-toggle');
      if ((await waitingSummary.getAttribute('aria-expanded')) === 'false') {
        await waitingSummary.click();
      }
      const finishedSummary = component.getByTestId('finished-agent-summary');
      if ((await finishedSummary.getAttribute('aria-expanded')) === 'false') {
        await finishedSummary.click();
      }
      await expect(component.getByTestId('finished-agent-list')).toBeVisible();
      await expect(component).toHaveScreenshot(
        `finished-participants-${theme}-${zoom === 1 ? '100' : '200'}.png`,
        { maxDiffPixelRatio: 0.02 },
      );
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

test('keeps the bell at the compact gap and on the outer-header text tone', async ({ mount }) => {
  const component = await mount(AgentSubscriptionInlineHost, { props: { mode: 'mixed' } });
  const summary = component.getByTestId('event-subscriptions-summary');

  for (const theme of ['light', 'dark'] as const) {
    for (const width of [270, 340]) {
      for (const zoom of [1, 2]) {
        await component.update({ props: { mode: 'mixed', theme, width, zoom } });
        for (const expanded of [true, false]) {
          if ((await summary.getAttribute('aria-expanded')) !== String(expanded)) {
            await summary.click();
          }
          await expect(summary).toHaveAttribute('aria-expanded', String(expanded));
          const geometry = await component.evaluate((root) => {
            const leading = root.querySelector(
              '[data-testid="event-subscriptions-leading-column"]',
            ) as HTMLElement;
            const icon = leading.querySelector('svg')!;
            const title = root.querySelector(
              '[data-testid="event-subscriptions-summary-title"]',
            ) as HTMLElement;
            const slotBox = leading.getBoundingClientRect();
            const iconBox = icon.getBoundingClientRect();
            return {
              slotWidth: slotBox.width,
              slotRight: slotBox.right,
              slotCenterX: (slotBox.left + slotBox.right) / 2,
              slotCenterY: (slotBox.top + slotBox.bottom) / 2,
              iconWidth: iconBox.width,
              iconRight: iconBox.right,
              titleLeft: title.getBoundingClientRect().left,
              iconCenterX: (iconBox.left + iconBox.right) / 2,
              iconCenterY: (iconBox.top + iconBox.bottom) / 2,
              iconColor: getComputedStyle(icon).color,
              iconOpacity: getComputedStyle(icon).opacity,
              titleColor: getComputedStyle(title).color,
            };
          });
          expect(geometry.slotWidth).toBeCloseTo(20 * zoom, 1);
          expect(geometry.iconWidth).toBeCloseTo(14 * zoom, 1);
          expect(geometry.iconCenterX).toBeCloseTo(geometry.slotCenterX, 1);
          expect(geometry.iconCenterY).toBeCloseTo(geometry.slotCenterY, 1);
          expect(geometry.titleLeft - geometry.slotRight).toBeCloseTo(8 * zoom, 1);
          expect(geometry.iconOpacity).toBe('1');
          expect(geometry.iconColor).toBe(geometry.titleColor);
          await expect(
            component.getByTestId('event-subscriptions-leading-column').locator('svg'),
          ).toHaveCount(1);
        }
      }
    }
  }
});

test('caps one through eight participants at three and computes overflow from remaining agents', async ({
  mount,
}) => {
  const component = await mount(AgentSubscriptionInlineHost, {
    props: { mode: 'agents', agentCount: 1, width: 600, initiallyExpanded: false },
  });
  const summary = component.getByTestId('one-shot-summary-toggle');

  for (let agentCount = 1; agentCount <= 8; agentCount += 1) {
    await component.update({
      props: { mode: 'agents', agentCount, width: 600, initiallyExpanded: false },
    });
    if ((await summary.getAttribute('aria-expanded')) === 'true') await summary.click();
    const stack = component.getByTestId('one-shot-header').locator('[data-agent-avatar-stack]');
    const visibleCount = Math.min(agentCount, 3);
    await expect
      .poll(() => stack.locator('[data-agent-avatar-with-state]').count())
      .toBe(visibleCount);
    if (agentCount === visibleCount) {
      await expect(stack.locator('[data-agent-avatar-overflow]')).toHaveCount(0);
    } else {
      await expect(stack.locator('[data-agent-avatar-overflow]')).toHaveText(
        `+${agentCount - visibleCount}`,
      );
    }
    await expect(stack.locator('[data-icon]')).toHaveCount(0);
  }

  for (const [agentCount, remaining] of [
    [9, 6],
    [12, 9],
  ] as const) {
    await component.update({
      props: { mode: 'agents', agentCount, width: 600, initiallyExpanded: false },
    });
    const stack = component.getByTestId('one-shot-header').locator('[data-agent-avatar-stack]');
    await expect.poll(() => stack.locator('[data-agent-avatar-with-state]').count()).toBe(3);
    await expect(stack.locator('[data-agent-avatar-overflow]')).toHaveText(`+${remaining}`);
  }

  await component.update({
    props: { mode: 'agents', agentCount: 6, width: 120, initiallyExpanded: false },
  });
  const narrowStack = component.getByTestId('one-shot-header').locator('[data-agent-avatar-stack]');
  /* The adaptive stack applies ResizeObserver widths one animation frame later
     (createDeferredWidthApplier), so after a width change the visible count
     settles asynchronously. Reading count() and the badge in separate calls
     can straddle that settling frame (#4019) — read both atomically in one
     evaluate and assert the pair is self-consistent. A leading double rAF
     lets any ResizeObserver delivery pending at entry fire (next frame) and
     its deferred width apply (the frame after) before the first read, and
     agreement across a second double rAF guards against a delivery arriving
     mid-check — so the poll observes the settled adaptive state rather than
     passing on the pre-measurement default frame. The exact settled count is
     not pinned because the stack's available width depends on surrounding
     header layout. */
  await expect
    .poll(() =>
      narrowStack.evaluate(async (stack) => {
        const read = () => {
          const visible = stack.querySelectorAll('[data-agent-avatar-with-state]').length;
          const badge =
            stack.querySelector('[data-agent-avatar-overflow]')?.textContent?.trim() ?? null;
          return { visible, badge };
        };
        const settleWindow = () =>
          new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await settleWindow();
        const first = read();
        await settleWindow();
        const second = read();
        return {
          settled: first.visible === second.visible && first.badge === second.badge,
          capped: second.visible < 6,
          consistent: second.badge === `+${6 - second.visible}`,
        };
      }),
    )
    .toEqual({ settled: true, capped: true, consistent: true });

  await component.update({
    props: { mode: 'agents', agentCount: 12, width: 600, initiallyExpanded: false },
  });
  const measuredStack = component
    .getByTestId('one-shot-header')
    .locator('[data-agent-avatar-stack]');
  /* The cutout mask is applied via CSS after the stack items render; under
     load (e.g. shared CI runners) the style evaluate below can win the race
     and read maskImage before it is applied. Wait for the masks first. The
     poll requires all three items plus the settled +9 badge in the same
     frame so it cannot pass vacuously (`[].every()` is true) on a transient
     frame where the deferred width has not yet applied (#4019). */
  await expect
    .poll(() =>
      measuredStack.evaluate((stack) => {
        const items = Array.from(
          stack.querySelectorAll<HTMLElement>('[data-agent-avatar-stack-item]'),
        );
        const badge = stack.querySelector('[data-agent-avatar-overflow]')?.textContent?.trim();
        return (
          items.length === 3 &&
          badge === '+9' &&
          items.slice(0, -1).every((item) => getComputedStyle(item).maskImage.includes('url('))
        );
      }),
    )
    .toBe(true);
  /* Read the settled 3-item state and its styles in ONE evaluate: a separate
     count/style read pair can straddle a deferred-width settling frame and
     observe a transient 0-item stack (#4019). Returns null until settled so
     the poll retries instead of failing on a transient frame. */
  const readStyle = () =>
    measuredStack.evaluate((stack) => {
      const items = Array.from(
        stack.querySelectorAll<HTMLElement>('[data-agent-avatar-stack-item]'),
      );
      const overflow = stack.querySelector('[data-agent-avatar-overflow]') as HTMLElement | null;
      if (items.length !== 3 || overflow?.textContent?.trim() !== '+9') return null;
      const stackBox = stack.getBoundingClientRect();
      const overflowBox = overflow.getBoundingClientRect();
      return {
        zIndexes: items.map((item) => Number(getComputedStyle(item).zIndex)),
        masks: items.map((item) => getComputedStyle(item).maskImage),
        avatarPseudos: items.map((item) => {
          const pseudo = getComputedStyle(
            item.querySelector('[data-agent-avatar-with-state]')!,
            '::after',
          );
          return { content: pseudo.content, width: pseudo.borderTopWidth };
        }),
        overflowFontSize: getComputedStyle(overflow).fontSize,
        overflowBackground: getComputedStyle(overflow).backgroundColor,
        overflowCenterY: (overflowBox.top + overflowBox.bottom) / 2,
        stackCenterY: (stackBox.top + stackBox.bottom) / 2,
        devicePixelRatio: window.devicePixelRatio,
      };
    });
  /* Capture the value inside the poll: a separate re-read after the poll can
     land back in a transient frame and observe null again. */
  let style: Awaited<ReturnType<typeof readStyle>> = null;
  await expect
    .poll(async () => {
      style = await readStyle();
      return style;
    })
    .not.toBeNull();
  if (!style) throw new Error('unreachable: poll guarantees a non-null style');
  expect(style.zIndexes).toEqual([1, 2, 3]);
  for (const mask of style.masks) {
    expect(mask).toContain('url(');
    expect(mask).not.toContain('radial-gradient');
  }
  expect(style.avatarPseudos).toEqual(Array(3).fill({ content: 'none', width: '0px' }));
  expect(style.overflowFontSize).toBe('12px');
  expect(style.overflowBackground).not.toBe('rgba(0, 0, 0, 0)');
  expect(
    Math.abs(style.overflowCenterY - style.stackCenterY) * style.devicePixelRatio,
  ).toBeLessThanOrEqual(0.5);
});

test('toggles exactly once from every full-row disclosure region and not from agent rows', async ({
  mount,
}) => {
  const component = await mount(AgentSubscriptionInlineHost, {
    props: { mode: 'agents', agentCount: 12, width: 600, initiallyExpanded: false },
  });
  const summary = component.getByTestId('one-shot-summary-toggle');
  const stack = summary.locator('[data-agent-avatar-stack]');
  await expect(summary).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(() => stack.locator('[data-agent-avatar-stack-item]').count()).toBe(3);
  await expect(stack.locator('[data-agent-avatar-overflow]')).toHaveText('+9');

  const regions = [
    component.getByTestId('one-shot-leading-column'),
    component.getByTestId('one-shot-summary-title'),
    stack.locator('[data-agent-avatar-stack-item]').first(),
    stack.locator('[data-agent-avatar-overflow]'),
    component.getByTestId('one-shot-collapse-toggle'),
  ];
  for (const region of regions) {
    await region.click();
    await expect(summary).toHaveAttribute('aria-expanded', 'true');
    await summary.click();
    await expect(summary).toHaveAttribute('aria-expanded', 'false');
  }

  const stackBox = await stack.boundingBox();
  const summaryBox = await summary.boundingBox();
  expect(stackBox).not.toBeNull();
  expect(summaryBox).not.toBeNull();
  await summary.click({
    position: {
      x: stackBox!.x - summaryBox!.x + 2,
      y: stackBox!.y - summaryBox!.y + stackBox!.height / 2,
    },
  });
  await expect(summary).toHaveAttribute('aria-expanded', 'true');
  await component
    .getByTestId('agent-list-item')
    .first()
    .locator('button')
    .evaluate((row) => row.click());
  await expect(summary).toHaveAttribute('aria-expanded', 'true');

  await summary.press('Enter');
  await expect(summary).toHaveAttribute('aria-expanded', 'false');
  await summary.press(' ');
  await expect(summary).toHaveAttribute('aria-expanded', 'true');
  await expect(summary).toBeFocused();
});

test('pins the participant stack before a fixed trailing chevron slot', async ({ mount }) => {
  const component = await mount(AgentSubscriptionInlineHost, {
    props: { mode: 'agents', agentCount: 6, initiallyExpanded: false },
  });

  for (const theme of ['light', 'dark'] as const) {
    for (const width of [220, 600]) {
      for (const zoom of [1, 2]) {
        let expectedChevronRight: number | undefined;
        for (const agentCount of [1, 6, 12]) {
          await component.update({
            props: {
              mode: 'agents',
              agentCount,
              longLabels: agentCount === 12,
              initiallyExpanded: false,
              theme,
              width,
              zoom,
            },
          });
          const summary = component.getByTestId('one-shot-summary-toggle');
          const chevron = component.getByTestId('one-shot-collapse-toggle');
          if ((await summary.getAttribute('aria-expanded')) === 'true') await summary.click();
          await expect(summary).toHaveAttribute('aria-expanded', 'false');
          await expect(chevron.locator('[data-icon="chevron-down"]')).toHaveClass(/rotate-90/);

          const collapsed = await component.getByTestId('one-shot-header').evaluate((header) => {
            const slot = header.querySelector(
              '[data-testid="one-shot-collapse-toggle"]',
            ) as HTMLElement;
            const stack = header.querySelector('[data-agent-avatar-stack]') as HTMLElement;
            const headerBox = header.getBoundingClientRect();
            const slotBox = slot.getBoundingClientRect();
            const stackBox = stack.getBoundingClientRect();
            return {
              headerRight: headerBox.right,
              headerCenterY: (headerBox.top + headerBox.bottom) / 2,
              slotRight: slotBox.right,
              slotCenterY: (slotBox.top + slotBox.bottom) / 2,
              slotWidth: slotBox.width,
              slotHeight: slotBox.height,
              stackRight: stackBox.right,
              devicePixelRatio: window.devicePixelRatio,
            };
          });
          expectedChevronRight ??= collapsed.slotRight;
          expect(
            Math.abs(collapsed.slotRight - expectedChevronRight) * collapsed.devicePixelRatio,
          ).toBeLessThanOrEqual(0.5);
          expect(collapsed.slotWidth).toBeCloseTo(24 * zoom, 1);
          expect(collapsed.slotHeight).toBeCloseTo(24 * zoom, 1);
          expect(collapsed.headerRight - collapsed.slotRight).toBeCloseTo(12 * zoom, 1);
          expect(
            Math.abs(collapsed.slotCenterY - collapsed.headerCenterY) * collapsed.devicePixelRatio,
          ).toBeLessThanOrEqual(0.5);
          expect(collapsed.stackRight).toBeLessThanOrEqual(collapsed.slotRight - 8 * zoom + 0.5);

          await summary.press('Enter');
          await expect(summary).toHaveAttribute('aria-expanded', 'true');
          await expect(chevron.locator('[data-icon="chevron-down"]')).not.toHaveClass(/rotate-90/);
          await expect(component.getByTestId('one-shot-agent-list')).toBeVisible();
          const expandedRight = await chevron.evaluate(
            (slot) => slot.getBoundingClientRect().right,
          );
          expect(
            Math.abs(expandedRight - collapsed.slotRight) * collapsed.devicePixelRatio,
          ).toBeLessThanOrEqual(0.5);
          await summary.press(' ');
          await expect(summary).toHaveAttribute('aria-expanded', 'false');
          await expect(summary).toBeFocused();
        }
      }
    }
  }
});

test('shows only participant agents in the mixed collapsed cohort stack', async ({ mount }) => {
  const component = await mount(AgentSubscriptionInlineHost, {
    props: { mode: 'mixed', agentCount: 7, width: 600, initiallyExpanded: false },
  });
  const summary = component.getByTestId('event-subscriptions-summary');
  const chevron = component.getByTestId('event-subscriptions-chevron');
  const stack = summary.locator('[data-agent-avatar-stack]');
  await expect(summary).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(() => stack.locator('[data-agent-avatar-with-state]').count()).toBe(7);
  await expect(stack.locator('[data-agent-avatar-overflow], [data-icon]')).toHaveCount(0);
  const collapsedRight = await chevron.evaluate((slot) => slot.getBoundingClientRect().right);
  await summary.press(' ');
  await expect(summary).toHaveAttribute('aria-expanded', 'true');
  await expect(stack).toHaveCount(0);
  await expect(component.getByTestId('event-subscriptions-body')).toHaveAttribute(
    'aria-hidden',
    'false',
  );
  expect(await chevron.evaluate((slot) => slot.getBoundingClientRect().right)).toBeCloseTo(
    collapsedRight,
    1,
  );
  await component.getByTestId('one-shot-summary-toggle').press('Enter');
  await expect(component.getByTestId('one-shot-agent-list')).toBeVisible();
  await expect(component.getByTestId('mixed-subscription-preview')).toBeVisible();
});

test('keeps 27 live participant surfaces on one rounded-square overlap geometry', async ({
  mount,
  page,
}) => {
  const component = await mount(AgentSubscriptionInlineHost, {
    props: { mode: 'agents', agentCount: 27, width: 420, initiallyExpanded: false },
  });

  for (const theme of ['light', 'dark'] as const) {
    for (const zoom of [1, 2]) {
      await component.update({
        props: {
          mode: 'agents',
          agentCount: 27,
          width: 420,
          initiallyExpanded: false,
          theme,
          zoom,
        },
      });
      await expect(page.locator('html')).toHaveClass(new RegExp(`(?:^|\\s)${theme}(?:\\s|$)`));
      const summary = component.getByTestId('one-shot-summary-toggle');
      if ((await summary.getAttribute('aria-expanded')) === 'true') await summary.click();
      await expect(summary).toContainText('Waiting for 27 agents');
      const stack = summary.locator('[data-agent-avatar-stack]');
      await expect.poll(() => stack.locator('[data-agent-avatar-stack-item]').count()).toBe(3);
      const visibleCount = await stack.locator('[data-agent-avatar-stack-item]').count();
      await expect(stack.locator('[data-agent-avatar-overflow]')).toHaveText('+24');
      await expect(stack.locator('[data-avatar-state="running"]')).toHaveCount(1);
      await expect
        .poll(() =>
          stack
            .locator('[data-agent-avatar-with-state]')
            .evaluateAll(
              (items) => new Set(items.map((item) => getComputedStyle(item).backgroundColor)).size,
            ),
        )
        .toBe(2);

      const geometry = await stack.evaluate((root) => {
        const items = Array.from(
          root.querySelectorAll<HTMLElement>('[data-agent-avatar-stack-item]'),
        );
        return items.map((item) => {
          const surface = item.querySelector<HTMLElement>('[data-agent-avatar-with-state]')!;
          const avatar = surface.querySelector<SVGElement>('[data-agent-avatar]')!;
          const itemBox = item.getBoundingClientRect();
          const surfaceBox = surface.getBoundingClientRect();
          const avatarBox = avatar.getBoundingClientRect();
          const itemStyle = getComputedStyle(item);
          const surfaceStyle = getComputedStyle(surface);
          const avatarStyle = getComputedStyle(avatar);
          const surfaceEdgeStyle = getComputedStyle(surface, '::after');
          return {
            itemBox: {
              left: itemBox.left,
              right: itemBox.right,
              width: itemBox.width,
              height: itemBox.height,
            },
            surfaceBox: { width: surfaceBox.width, height: surfaceBox.height },
            avatarBox: { width: avatarBox.width, height: avatarBox.height },
            radii: [
              itemStyle.borderTopLeftRadius,
              surfaceStyle.borderTopLeftRadius,
              avatarStyle.borderTopLeftRadius,
            ],
            backgrounds: [itemStyle.backgroundColor, surfaceStyle.backgroundColor],
            edges: {
              itemBorder: itemStyle.borderTopWidth,
              surfaceBorder: surfaceStyle.borderTopWidth,
              surfaceOutline: surfaceStyle.outlineStyle,
              surfaceShadow: surfaceStyle.boxShadow,
              pseudoContent: surfaceEdgeStyle.content,
              pseudoBorder: surfaceEdgeStyle.borderTopWidth,
              pseudoShadow: surfaceEdgeStyle.boxShadow,
            },
            zIndex: Number(itemStyle.zIndex),
            maskImage: itemStyle.maskImage,
            state: surface.dataset.avatarState,
          };
        });
      });

      expect(geometry.map((entry) => entry.zIndex)).toEqual(
        Array.from({ length: visibleCount }, (_, index) => index + 1),
      );
      expect(geometry.map((entry) => entry.state)).toEqual([
        'running',
        ...Array.from({ length: visibleCount - 1 }, () => 'idle'),
      ]);
      expect(new Set(geometry.map((entry) => entry.backgrounds[1])).size).toBe(2);
      for (const [index, entry] of geometry.entries()) {
        expect(entry.itemBox.width).toBeCloseTo(24 * zoom, 1);
        expect(entry.itemBox.height).toBeCloseTo(24 * zoom, 1);
        expect(entry.surfaceBox.width).toBeCloseTo(24 * zoom, 1);
        expect(entry.surfaceBox.height).toBeCloseTo(24 * zoom, 1);
        expect(entry.avatarBox.width).toBeCloseTo(24 * zoom, 1);
        expect(entry.avatarBox.height).toBeCloseTo(24 * zoom, 1);
        expect(entry.radii).toEqual(['7px', '7px', '7px']);
        expect(entry.backgrounds[0]).toBe('rgba(0, 0, 0, 0)');
        expect(entry.edges).toEqual({
          itemBorder: '0px',
          surfaceBorder: '0px',
          surfaceOutline: 'none',
          surfaceShadow: 'none',
          pseudoContent: 'none',
          pseudoBorder: '0px',
          pseudoShadow: 'none',
        });
        expect(entry.maskImage).toContain('url(');
        expect(entry.maskImage).not.toContain('radial-gradient');
        if (index < visibleCount - 1) {
          const next = geometry[index + 1];
          expect(entry.itemBox.right - next.itemBox.left).toBeCloseTo(6 * zoom, 1);
        }
      }
    }
  }
});

const canonicalAgentStateCases = [
  ['responding', 'running'],
  ['live-payload-tool', 'running'],
  ['in-flight-tool', 'running'],
  ['blocked-tool', 'waiting'],
  ['active-peer-turn', 'running'],
  ['peer-wait', 'waiting'],
  ['stale-waiting', 'running'],
] as const;

for (const [agentStateScenario, expected] of canonicalAgentStateCases) {
  test(`keeps ${agentStateScenario} ${expected} in production subscription surfaces`, async ({
    mount,
  }) => {
    const component = await mount(AgentSubscriptionInlineHost, {
      props: {
        mode: 'mixed',
        agentCount: 1,
        initiallyExpanded: false,
        agentStateScenario,
      },
    });
    const outerSummary = component.getByTestId('event-subscriptions-summary');
    if ((await outerSummary.getAttribute('aria-expanded')) === 'false') await outerSummary.click();
    const waitingSummary = component.getByTestId('one-shot-summary-toggle');
    if ((await waitingSummary.getAttribute('aria-expanded')) === 'false')
      await waitingSummary.click();
    await expect(
      component
        .locator(
          '[data-testid="agent-list-item"][data-agent-id="agent-subscription-inline-geometry"]',
        )
        .locator('[data-agent-avatar-with-state]'),
      `${agentStateScenario} should render ${expected} in the expanded row`,
    ).toHaveAttribute('data-avatar-state', expected);

    await waitingSummary.click();
    await expect(
      waitingSummary
        .locator('[data-agent-avatar-stack-agent-id="agent-subscription-inline-geometry"]')
        .locator('[data-agent-avatar-with-state]'),
      `${agentStateScenario} should remain ${expected} in the nested collapsed stack`,
    ).toHaveAttribute('data-avatar-state', expected);
    await outerSummary.click();
    await expect(
      outerSummary
        .locator('[data-agent-avatar-stack-agent-id="agent-subscription-inline-geometry"]')
        .locator('[data-agent-avatar-with-state]'),
      `${agentStateScenario} should remain ${expected} in the collapsed stack`,
    ).toHaveAttribute('data-avatar-state', expected);
  });
}

test('screenshots participant cutouts over varied parent backgrounds', async ({ mount }) => {
  const component = await mount(AgentSubscriptionInlineHost, {
    props: { mode: 'agents', agentCount: 6, width: 420, initiallyExpanded: false },
  });
  for (const theme of ['light', 'dark'] as const) {
    for (const parentBackground of ['background', 'muted', 'accent'] as const) {
      for (const zoom of [1, 2]) {
        await component.update({
          props: {
            mode: 'agents',
            agentCount: 6,
            width: 420,
            initiallyExpanded: false,
            theme,
            parentBackground,
            zoom,
          },
        });
        const summary = component.getByTestId('one-shot-summary-toggle');
        const stack = component.getByTestId('one-shot-header').locator('[data-agent-avatar-stack]');
        if ((await summary.getAttribute('aria-expanded')) === 'true') await summary.click();
        await expect.poll(() => stack.locator('[data-agent-avatar-with-state]').count()).toBe(3);
        await expect(stack.locator('[data-agent-avatar-overflow]')).toHaveText('+3');
        await expect(component).toHaveScreenshot(
          `participant-stack-${theme}-${parentBackground}-${zoom === 1 ? '100' : '200'}.png`,
          { maxDiffPixelRatio: 0.012 },
        );
      }
    }
  }
});

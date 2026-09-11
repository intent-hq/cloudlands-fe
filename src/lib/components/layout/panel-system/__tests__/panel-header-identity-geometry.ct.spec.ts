import { expect, test } from '@playwright/experimental-ct-svelte';
import PanelHeaderIdentityHost from './mocks/PanelHeaderIdentityHost.svelte';

const panelTypes = ['agent', 'note', 'file', 'terminal', 'browser', 'settings'] as const;

test('keeps one larger identity geometry across panel types, themes, widths, and zoom', async ({
  mount,
}) => {
  const component = await mount(PanelHeaderIdentityHost);
  let measuredStates = 0;

  for (const theme of ['light', 'dark'] as const) {
    for (const width of [240, 560]) {
      for (const zoom of [1, 2]) {
        for (const identityType of panelTypes) {
          await component.update({ props: { identityType, theme, width, height: 320, zoom } });
          const geometry = await component
            .locator('[data-panel-content-header]')
            .evaluate((header) => {
              const leading = header.querySelector<HTMLElement>(
                '[data-panel-header-leading-surface]',
              )!;
              const leadingGlyph = leading.querySelector<SVGElement>('svg')!;
              const title = header.querySelector<HTMLElement>('[data-panel-header-title]')!;
              const titleText = title.querySelector<HTMLElement>('button, span')!;
              const actions = header.querySelector<HTMLElement>('[data-panel-header-actions]')!;
              const bodyCopy = header.parentElement!.parentElement!.querySelector<HTMLElement>(
                '[data-panel-body-copy-probe]',
              )!;
              const headerRect = header.getBoundingClientRect();
              const leadingRect = leading.getBoundingClientRect();
              const leadingGlyphRect = leadingGlyph.getBoundingClientRect();
              const leadingGlyphStyle = getComputedStyle(leadingGlyph);
              const titleRect = title.getBoundingClientRect();
              const actionsRect = actions.getBoundingClientRect();
              const scale = headerRect.width / (header as HTMLElement).offsetWidth;
              return {
                headerHeight: headerRect.height / scale,
                leadingWidth: leadingRect.width / scale,
                leadingHeight: leadingRect.height / scale,
                leadingGlyphContentWidth:
                  leadingGlyphRect.width / scale -
                  Number.parseFloat(leadingGlyphStyle.paddingLeft) -
                  Number.parseFloat(leadingGlyphStyle.paddingRight),
                leadingCenterDelta:
                  Math.abs(
                    leadingRect.top +
                      leadingRect.height / 2 -
                      (headerRect.top + headerRect.height / 2),
                  ) / scale,
                titleFontSize: getComputedStyle(titleText).fontSize,
                titleLineHeight: getComputedStyle(titleText).lineHeight,
                bodyFontSize: getComputedStyle(bodyCopy).fontSize,
                bodyLineHeight: getComputedStyle(bodyCopy).lineHeight,
                titleTop: (titleRect.top - headerRect.top) / scale,
                titleBottom: (headerRect.bottom - titleRect.bottom) / scale,
                titleActionsGap: (actionsRect.left - titleRect.right) / scale,
                actionsRightInset: (headerRect.right - actionsRect.right) / scale,
                actionsCenterDelta:
                  Math.abs(
                    actionsRect.top +
                      actionsRect.height / 2 -
                      (headerRect.top + headerRect.height / 2),
                  ) / scale,
                hasPanelPin: actions.querySelector('[data-panel-pin]') !== null,
              };
            });

          expect(geometry.headerHeight).toBeCloseTo(32, 1);
          expect(geometry.leadingWidth).toBeCloseTo(24, 1);
          expect(geometry.leadingHeight).toBeCloseTo(24, 1);
          expect(geometry.leadingGlyphContentWidth).toBeCloseTo(
            identityType === 'agent' ? 20 : 16,
            1,
          );
          expect(geometry.leadingCenterDelta).toBeLessThanOrEqual(0.6);
          expect(geometry.titleFontSize).toBe(geometry.bodyFontSize);
          expect(geometry.titleLineHeight).toBe(geometry.bodyLineHeight);
          expect(geometry.titleTop).toBeGreaterThanOrEqual(0);
          expect(geometry.titleBottom).toBeGreaterThanOrEqual(0);
          expect(geometry.titleActionsGap).toBeGreaterThanOrEqual(0);
          expect(geometry.actionsRightInset).toBeCloseTo(10, 1);
          expect(geometry.actionsCenterDelta).toBeLessThanOrEqual(0.6);
          expect(geometry.hasPanelPin).toBe(false);

          const firstAction = component
            .locator('[data-panel-header-actions] button:visible')
            .first();
          await firstAction.focus();
          await expect(firstAction).toBeFocused();
          measuredStates += 1;
        }
      }
    }
  }

  expect(measuredStates).toBe(48);
});

test('uses the same larger leading identity geometry in the empty panel actions', async ({
  mount,
}) => {
  const component = await mount(PanelHeaderIdentityHost, {
    props: { identityType: 'empty', theme: 'dark', width: 240, height: 320, zoom: 2 },
  });
  const cards = component.locator('.creation-card');
  await expect(cards).toHaveCount(4);

  const geometry = await cards.evaluateAll((elements) =>
    elements.map((card) => {
      const leading = card.querySelector<HTMLElement>(
        '[data-resource-icon-tile], [data-panel-empty-leading-surface]',
      )!;
      const glyph = leading.querySelector<HTMLElement>('svg, [data-resource-icon-glyph]')!;
      const leadingStyle = getComputedStyle(leading);
      return {
        leadingWidth: leadingStyle.width,
        leadingHeight: leadingStyle.height,
        glyphWidth: getComputedStyle(glyph).width,
      };
    }),
  );

  for (const item of geometry) {
    expect(item.leadingWidth).toBe('24px');
    expect(item.leadingHeight).toBe('24px');
    expect(item.glyphWidth).toBe('16px');
  }
});

test('shows the complete agent edit border without shifting the header identity', async ({
  mount,
}) => {
  const component = await mount(PanelHeaderIdentityHost, {
    props: { identityType: 'agent', theme: 'light', width: 560, height: 320 },
  });
  const header = component.locator('[data-panel-content-header]');

  const measurePositions = () =>
    header.evaluate((element) => {
      const rect = (selector: string) => {
        const bounds = element.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
        return { left: bounds.left, top: bounds.top };
      };
      return {
        avatar: rect('[data-panel-header-leading-surface]'),
        title: rect('[data-panel-header-title]'),
        actions: rect('[data-panel-header-actions]'),
      };
    });

  const before = await measurePositions();
  await component.locator('[data-panel-header-title] button').click();
  await expect(component.locator('[data-panel-header-title] input')).toBeFocused();

  const editing = await header.evaluate((element) => {
    const decoration = element.querySelector<HTMLElement>(
      '[data-panel-header-title] span[aria-hidden="true"]',
    )!;
    const decorationRect = decoration.getBoundingClientRect();
    const style = getComputedStyle(decoration);
    const clippedBy: string[] = [];
    let ancestor = decoration.parentElement;
    while (ancestor && ancestor !== element.parentElement) {
      const ancestorStyle = getComputedStyle(ancestor);
      const ancestorRect = ancestor.getBoundingClientRect();
      const clipsX = ancestorStyle.overflowX !== 'visible';
      const clipsY = ancestorStyle.overflowY !== 'visible';
      if (
        (clipsX &&
          (decorationRect.left < ancestorRect.left || decorationRect.right > ancestorRect.right)) ||
        (clipsY &&
          (decorationRect.top < ancestorRect.top || decorationRect.bottom > ancestorRect.bottom))
      ) {
        clippedBy.push(
          ancestor.getAttribute('data-panel-agent-header-identity') === ''
            ? 'identity'
            : ancestor.tagName,
        );
      }
      ancestor = ancestor.parentElement;
    }
    return {
      clippedBy,
      borderWidths: [
        style.borderTopWidth,
        style.borderRightWidth,
        style.borderBottomWidth,
        style.borderLeftWidth,
      ],
      borderStyles: [
        style.borderTopStyle,
        style.borderRightStyle,
        style.borderBottomStyle,
        style.borderLeftStyle,
      ],
    };
  });
  const after = await measurePositions();

  expect(editing.clippedBy).toEqual([]);
  expect(editing.borderWidths).toEqual(['1px', '1px', '1px', '1px']);
  expect(editing.borderStyles).toEqual(['solid', 'solid', 'solid', 'solid']);
  expect(after).toEqual(before);
});

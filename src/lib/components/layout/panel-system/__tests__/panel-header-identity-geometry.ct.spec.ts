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

test('uses aligned Swiss action rows in the empty panel', async ({ mount }) => {
  const component = await mount(PanelHeaderIdentityHost, {
    props: { identityType: 'empty', theme: 'dark', width: 240, height: 320, zoom: 2 },
  });
  const actions = component.locator('.creation-action');
  await expect(actions).toHaveCount(4);
  for (const name of ['New Agent', 'New Note', 'New Terminal', 'New Browser']) {
    await expect(component.getByRole('button', { name })).toBeVisible();
  }

  const geometry = await actions.evaluateAll((elements) =>
    elements.map((action) => {
      const row = action as HTMLElement;
      const leftGroup = row.firstElementChild as HTMLElement;
      const glyph = leftGroup.querySelector<SVGElement>('svg')!;
      const label = leftGroup.lastElementChild as HTMLElement;
      const hint = row.querySelector<HTMLElement>('kbd')!;
      const rowRect = row.getBoundingClientRect();
      const glyphRect = glyph.getBoundingClientRect();
      const labelRect = label.getBoundingClientRect();
      const hintRect = hint.getBoundingClientRect();
      const scale = rowRect.width / row.offsetWidth;
      return {
        rowHeight: rowRect.height / scale,
        fontSize: getComputedStyle(label).fontSize,
        glyphLeft: (glyphRect.left - rowRect.left) / scale,
        labelLeft: (labelRect.left - rowRect.left) / scale,
        labelGlyphGap: (labelRect.left - glyphRect.right) / scale,
        hintRightInset: (rowRect.right - hintRect.right) / scale,
        hintTextAlign: getComputedStyle(hint).textAlign,
      };
    }),
  );

  const first = geometry[0];
  for (const item of geometry) {
    expect(item.rowHeight).toBeCloseTo(28, 1);
    expect(item.fontSize).toBe('13px');
    expect(item.glyphLeft).toBeCloseTo(first.glyphLeft, 1);
    expect(item.labelLeft).toBeCloseTo(first.labelLeft, 1);
    expect(item.labelGlyphGap).toBeCloseTo(8, 1);
    expect(item.hintRightInset).toBeCloseTo(8, 1);
    expect(item.hintTextAlign).toBe('right');
  }
});

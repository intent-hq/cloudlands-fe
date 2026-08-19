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
              const title = header.querySelector<HTMLElement>('[data-panel-header-title]')!;
              const titleText = title.querySelector<HTMLElement>('button, span')!;
              const actions = header.querySelector<HTMLElement>('[data-panel-header-actions]')!;
              const bodyCopy = header.parentElement!.parentElement!.querySelector<HTMLElement>(
                '[data-panel-body-copy-probe]',
              )!;
              const headerRect = header.getBoundingClientRect();
              const leadingRect = leading.getBoundingClientRect();
              const titleRect = title.getBoundingClientRect();
              const actionsRect = actions.getBoundingClientRect();
              const scale = headerRect.width / (header as HTMLElement).offsetWidth;
              return {
                headerHeight: headerRect.height / scale,
                leadingWidth: leadingRect.width / scale,
                leadingHeight: leadingRect.height / scale,
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
                firstActionIsPin:
                  actions.firstElementChild?.querySelector('[data-panel-pin]') !== null,
              };
            });

          expect(geometry.headerHeight).toBeCloseTo(32, 1);
          expect(geometry.leadingWidth).toBeCloseTo(24, 1);
          expect(geometry.leadingHeight).toBeCloseTo(24, 1);
          expect(geometry.leadingCenterDelta).toBeLessThanOrEqual(0.6);
          expect(geometry.titleFontSize).toBe(geometry.bodyFontSize);
          expect(geometry.titleLineHeight).toBe(geometry.bodyLineHeight);
          expect(geometry.titleTop).toBeGreaterThanOrEqual(0);
          expect(geometry.titleBottom).toBeGreaterThanOrEqual(0);
          expect(geometry.titleActionsGap).toBeGreaterThanOrEqual(0);
          expect(geometry.actionsRightInset).toBeCloseTo(10, 1);
          expect(geometry.actionsCenterDelta).toBeLessThanOrEqual(0.6);
          expect(geometry.firstActionIsPin).toBe(true);

          const pin = component.locator('[data-panel-pin]:visible').first();
          await pin.focus();
          await expect(pin).toBeFocused();
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

test('rotates the thumbtack only for the pressed pinned state', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(PanelHeaderIdentityHost, {
    props: { pinned: false, pinMode: true },
  });
  const pin = component.locator('[data-panel-pin]:visible').first();
  const icon = pin.locator('[data-panel-pin-icon]');

  await expect(pin).toHaveAttribute('aria-pressed', 'false');
  expect(await icon.evaluate((node) => getComputedStyle(node).transform)).toBe('none');

  await component.update({ props: { pinned: true } });
  await expect(pin).toHaveAttribute('aria-pressed', 'true');
  expect(await icon.evaluate((node) => getComputedStyle(node).transform)).toBe(
    'matrix(0.707107, -0.707107, 0.707107, 0.707107, 0, 0)',
  );
  const reducedDuration = await icon.evaluate((node) =>
    Number.parseFloat(getComputedStyle(node).transitionDuration),
  );
  expect(reducedDuration).toBeLessThanOrEqual(0.00001);
});

test('hides the panel header thumbtack while pin mode is off', async ({ mount }) => {
  const component = await mount(PanelHeaderIdentityHost, {
    props: { pinned: true, pinMode: false },
  });

  await expect(component.locator('[data-panel-pin]')).toHaveCount(0);
});

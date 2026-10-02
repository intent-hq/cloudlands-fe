import { expect, test } from '../../../../../test/ct-test';
import PanelHeaderIdentityHost from './mocks/PanelHeaderIdentityHost.svelte';

for (const identityType of ['agent', 'note', 'file', 'terminal', 'browser', 'settings'] as const) {
  test(`keeps the ${identityType} selector reachable without overlapping actions at narrow zoom`, async ({
    mount,
    page,
  }, testInfo) => {
    const component = await mount(PanelHeaderIdentityHost, {
      props: { identityType, width: 240, height: 320, zoom: 2 },
    });
    const header = component.locator('[data-panel-content-header]');
    const geometry = await header.evaluate((node) => {
      const header = node.getBoundingClientRect();
      const selector = node
        .querySelector('[data-pane-stack-selector-trigger]')!
        .getBoundingClientRect();
      const actions = node.querySelector('[data-panel-header-actions]')!.getBoundingClientRect();
      return {
        contained: selector.left >= header.left && actions.right <= header.right,
        noOverlap: selector.right <= actions.left,
        usable: selector.width > 0 && selector.height > 0,
      };
    });
    expect(geometry).toEqual({ contained: true, noOverlap: true, usable: true });
    const selector = header.getByTestId('pane-stack-selector-trigger');
    await selector.press('Enter');
    const menu = page.getByRole('menu', { name: 'Panes in this stack' });
    await expect(menu.locator('[data-pane-stack-item]')).toHaveAttribute('aria-current', 'page');
    await page.keyboard.press('Escape');
    await expect(selector).toBeFocused();
    await testInfo.attach('header-identity', {
      body: await header.screenshot(),
      contentType: 'image/png',
    });
  });
}

test('uses aligned Swiss action rows in the empty panel', async ({ mount }, testInfo) => {
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
      // Button paints its surface on a leading `button-surface` slot; the
      // content group is the first non-slot child.
      const leftGroup = row.querySelector<HTMLElement>(':scope > :not([data-slot])')!;
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
  await testInfo.attach('empty-panel', {
    body: await component.screenshot(),
    contentType: 'image/png',
  });
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

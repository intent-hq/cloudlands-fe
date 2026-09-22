import type { Page } from '@playwright/experimental-ct-svelte';
import { expect, test } from '../../../../../test/ct-test';
import PanelDragPreview from '../PanelDragPreview.svelte';

/**
 * The projected drop destination is an inert, low-emphasis card: a plain
 * border and a translucent card fill, no accent or primary tint and no
 * shadow, and it never intercepts pointer events. Under forced colors it
 * keeps a system-color outline so the destination stays visible. These are
 * computed-style facts that only a real browser resolves; the jsdom suite
 * covers the projected structure.
 */

const props = {
  node: { type: 'panel' as const, panelId: 'destination' },
  panels: {
    destination: {
      id: 'destination',
      tabs: [{ id: 'tab', type: 'note' as const, title: 'Tab', closable: true }],
      activeTabId: 'tab',
    },
  },
  draggedPanelId: 'destination',
};

type ColorProperty = 'backgroundColor' | 'borderTopColor';

async function tokenColor(page: Page, className: string, property: ColorProperty) {
  return page.evaluate(
    ([probeClass, probeProperty]) => {
      const node = document.createElement('span');
      node.className = probeClass;
      document.body.append(node);
      const resolved = getComputedStyle(node)[probeProperty];
      node.remove();
      return resolved;
    },
    [className, property] as const,
  );
}

async function systemColor(page: Page, value: string) {
  return page.evaluate((propertyValue) => {
    const node = document.createElement('span');
    node.style.color = propertyValue;
    document.body.append(node);
    const resolved = getComputedStyle(node).color;
    node.remove();
    return resolved;
  }, value);
}

function withAlpha(color: string, alpha: string) {
  const channels = color.match(/\d+/g)?.slice(0, 3).join(', ');
  return `rgba(${channels}, ${alpha})`;
}

test('renders the destination as an inert translucent card without accent styling', async ({
  mount,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(PanelDragPreview, { props });
  const destination = component.locator('[data-panel-drop-destination]');

  await expect(destination).toHaveCSS('pointer-events', 'none');
  await expect(destination).toHaveCSS('box-shadow', 'none');
  await expect(destination).toHaveCSS('border-top-width', '1px');
  await expect(destination).toHaveCSS('border-top-style', 'solid');
  await expect(destination).toHaveCSS(
    'border-top-color',
    await tokenColor(page, 'border border-border', 'borderTopColor'),
  );
  const card = await tokenColor(page, 'bg-card', 'backgroundColor');
  await expect(destination).toHaveCSS('background-color', withAlpha(card, '0.42'));
  for (const accent of ['bg-primary', 'bg-accent'] as const) {
    expect(await destination.evaluate((node) => getComputedStyle(node).backgroundColor)).not.toBe(
      await tokenColor(page, accent, 'backgroundColor'),
    );
  }
});

test('keeps a system-color outline under forced colors', async ({ mount, page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  const component = await mount(PanelDragPreview, { props });
  const destination = component.locator('[data-panel-drop-destination]');

  const canvasText = await systemColor(page, 'CanvasText');
  await expect(destination).toHaveCSS('outline-style', 'solid');
  await expect(destination).toHaveCSS('outline-width', '2px');
  await expect(destination).toHaveCSS('outline-color', canvasText);
  await expect(destination).toHaveCSS('border-top-color', canvasText);
});

test('fades the destination in only when motion is not reduced', async ({ mount, page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const component = await mount(PanelDragPreview, { props });
  const destination = component.locator('[data-panel-drop-destination]');
  await expect(destination).toHaveCSS('animation-name', /panel-drop-destination-in$/);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(destination).toHaveCSS('animation-name', 'none');
});

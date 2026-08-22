import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Locator } from '@playwright/test';
import PanelModWShortcutHarness from './mocks/PanelModWShortcutHarness.svelte';

const state = (component: Locator) => component.getByTestId('mod-w-state');

function measureGeometry(component: Locator) {
  return component.evaluate(() => {
    const inset = document.querySelector<HTMLElement>('[data-testid="panel-workspace-inset"]')!;
    const canvas = inset.querySelector('.panel-canvas-resize-handle')?.parentElement as HTMLElement;
    const panels = [...document.querySelectorAll<HTMLElement>('[data-panel-id]')];
    const track = document.querySelector<HTMLElement>('.panel-navigator-track');
    const thumb = document.querySelector<HTMLElement>('[data-panel-navigator-thumb]');
    const trackRect = track?.getBoundingClientRect();
    const thumbRect = thumb?.getBoundingClientRect();
    return {
      insetClientWidth: inset.clientWidth,
      insetScrollWidth: inset.scrollWidth,
      insetRect: inset.getBoundingClientRect().toJSON(),
      canvasRect: canvas.getBoundingClientRect().toJSON(),
      panelWidths: panels.map((panel) => panel.getBoundingClientRect().width),
      navigatorSegments: document.querySelectorAll('[data-panel-navigator-segment]').length,
      navigatorInBounds:
        !!trackRect &&
        !!thumbRect &&
        thumbRect.left >= trackRect.left - 1 &&
        thumbRect.right <= trackRect.right + 1,
    };
  });
}

for (const { platform, isMac, modifier } of [
  { platform: 'macOS', isMac: true, modifier: 'Meta' },
  { platform: 'Windows/Linux', isMac: false, modifier: 'Control' },
]) {
  for (const zoomFactor of [1, 2]) {
    test(`Mod+W uses live geometry on ${platform} at ${zoomFactor * 100}% zoom`, async ({
      mount,
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const component = await mount(PanelModWShortcutHarness, { props: { zoomFactor, isMac } });
      const layoutState = state(component);
      const focusedPanel = component.locator('[data-panel-id="p2"]');

      await focusedPanel.click({ position: { x: 20, y: 80 } });
      await expect(focusedPanel).toHaveAttribute('data-focused', 'true');
      expect(await layoutState.getAttribute('data-root-sizes')).toBe('20,50,30');
      await component.getByTestId('shortcut-input').focus();

      await page.keyboard.press(`${modifier}+w`);
      await expect(layoutState).toHaveAttribute('data-empty-panel-ids', 'p2');
      await expect(layoutState).toHaveAttribute('data-column-count', '3');
      await expect(layoutState).toHaveAttribute('data-panel-ids', 'p1,p2,p3');
      await expect(layoutState).toHaveAttribute('data-root-sizes', '20,50,30');

      await page.keyboard.press(`${modifier}+w`);
      await expect(layoutState).toHaveAttribute('data-column-count', '2');
      await expect(layoutState).toHaveAttribute('data-panel-ids', 'p1,p3');
      await expect(layoutState).toHaveAttribute('data-focused-panel', 'p3');
      await expect(layoutState).toHaveAttribute('data-root-sizes', '50,50');
      await expect(component.locator('[data-panel-id]')).toHaveCount(2);

      const geometry = await measureGeometry(component);
      expect(Math.abs(geometry.panelWidths[0] - geometry.panelWidths[1])).toBeLessThanOrEqual(1);
      expect(geometry.canvasRect.right).toBeLessThanOrEqual(geometry.insetRect.right + 1);
      expect(geometry.insetScrollWidth).toBeLessThanOrEqual(geometry.insetClientWidth + 1);
      expect(geometry.navigatorSegments).toBe(2);
      expect(geometry.navigatorInBounds).toBe(true);
      await expect(layoutState).toHaveAttribute(
        'data-tab-order',
        `other-workspace,mod-w-browser-${isMac ? 'mac' : 'non-mac'}-${zoomFactor}-3`,
      );
      await expect(layoutState).toHaveAttribute(
        'data-current-tab',
        `mod-w-browser-${isMac ? 'mac' : 'non-mac'}-${zoomFactor}-3`,
      );
      await expect(layoutState).toHaveAttribute('data-navigation-count', '0');

      await page.keyboard.press(`${modifier}+Shift+w`);
      await expect(layoutState).toHaveAttribute('data-tab-order', 'other-workspace');
      await expect(layoutState).toHaveAttribute('data-current-tab', 'other-workspace');
      await expect(layoutState).toHaveAttribute('data-navigation-count', '1');
      await expect(layoutState).toHaveAttribute(
        'data-navigation-path',
        '/workspace/other-workspace',
      );
      expect(page.isClosed()).toBe(false);

      await component.unmount();
      const finalComponent = await mount(PanelModWShortcutHarness, {
        props: { zoomFactor, panelCount: 1, isMac },
      });
      const finalState = state(finalComponent);
      await finalComponent.locator('[data-panel-id="p1"]').click({ position: { x: 20, y: 80 } });
      await page.keyboard.press(`${modifier}+w`);
      await expect(finalState).toHaveAttribute('data-empty-panel-ids', 'p1');
      await page.keyboard.press(`${modifier}+w`);
      await expect(finalState).toHaveAttribute('data-column-count', '1');
      await expect(finalState).toHaveAttribute('data-panel-ids', 'p1');
      await expect(finalState).toHaveAttribute('data-root-sizes', '100');
    });
  }
}

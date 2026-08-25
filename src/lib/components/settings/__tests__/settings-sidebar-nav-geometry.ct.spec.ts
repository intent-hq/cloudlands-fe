import { expect, test } from '@playwright/experimental-ct-svelte';
import SettingsSidebarNavGeometryHost from './SettingsSidebarNavGeometryHost.svelte';

for (const theme of ['light', 'dark'] as const) {
  for (const width of [200, 240]) {
    for (const zoom of [1, 2]) {
      test(`keeps settings rows aligned in ${theme} at ${width}px and ${zoom * 100}%`, async ({
        mount,
        page,
      }) => {
        await page.setViewportSize({ width: 1200, height: 1000 });
        const component = await mount(SettingsSidebarNavGeometryHost, {
          props: { theme, width, zoom },
        });
        const rows = component.getByRole('button');
        const geometry = await rows.evaluateAll((buttons) =>
          buttons.map((button) => {
            const row = button.getBoundingClientRect();
            const iconSlot = button.querySelector<HTMLElement>(
              '[data-slot="settings-sidebar-icon"]',
            )!;
            const icon = iconSlot.querySelector('svg')!.getBoundingClientRect();
            const label = button
              .querySelector<HTMLElement>('span:last-child')!
              .getBoundingClientRect();
            const slot = iconSlot.getBoundingClientRect();
            return {
              rowHeight: row.height,
              overflows: button.scrollWidth > button.clientWidth,
              iconWidth: icon.width,
              slotWidth: slot.width,
              iconCenterDelta: Math.abs(icon.left + icon.width / 2 - (slot.left + slot.width / 2)),
              labelCenterDelta: Math.abs(label.top + label.height / 2 - (row.top + row.height / 2)),
            };
          }),
        );

        expect(geometry).toHaveLength(7);
        expect(geometry.every(({ overflows }) => !overflows)).toBe(true);
        for (const row of geometry) {
          expect(row.rowHeight).toBeCloseTo(36 * zoom, 1);
          expect(row.slotWidth).toBeCloseTo(16 * zoom, 1);
          expect(row.iconWidth).toBeCloseTo(12.25 * zoom, 1);
          expect(row.iconCenterDelta).toBeLessThanOrEqual(0.5 * zoom);
          expect(row.labelCenterDelta).toBeLessThanOrEqual(0.5 * zoom);
        }

        const selected = component.getByRole('button', { name: 'System' });
        await expect(selected).toHaveAttribute('aria-current', 'page');
        const agentsSection = component.locator('[data-settings-agents-section]');
        await expect(agentsSection).not.toHaveClass(/border|mt-|pt-/);
        const [advancedBox, agentsHeadingBox, shellBox] = await Promise.all([
          component.getByRole('button', { name: 'Advanced' }).boundingBox(),
          component.getByRole('heading', { name: 'Agents' }).boundingBox(),
          component.getByTestId('sidebar-shell').boundingBox(),
        ]);
        expect(agentsHeadingBox!.y - (advancedBox!.y + advancedBox!.height)).toBeCloseTo(
          0,
          1,
        );
        expect(agentsHeadingBox!.y + agentsHeadingBox!.height).toBeLessThanOrEqual(
          shellBox!.y + shellBox!.height,
        );
        await component.getByRole('button', { name: 'Advanced' }).focus();
        await expect(component.getByRole('button', { name: 'Advanced' })).toBeFocused();
      });
    }
  }
}

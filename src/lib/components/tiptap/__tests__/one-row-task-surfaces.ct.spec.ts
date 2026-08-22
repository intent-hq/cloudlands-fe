import { expect, test } from '@playwright/experimental-ct-svelte';
import OneRowTaskSurfaceHarness from './OneRowTaskSurfaceHarness.svelte';

for (const zoom of [1, 2]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`keeps every linked and delegated task on one row at ${zoom * 100}% ${theme}`, async ({
      mount,
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const component = await mount(OneRowTaskSurfaceHarness, {
        props: { width: 420, theme, zoom },
      });
      const rows = component.locator('[data-task-item-row]');

      await expect(rows).toHaveCount(10);
      await expect(rows.locator('.status-content')).toHaveCount(0);
      await expect(component.locator('[data-task-note-preview]')).toHaveCount(0);
      await expect(component).not.toContainText('raw digest must stay hidden');
      await expect(component).not.toContainText('raw response');

      const geometry = await rows.evaluateAll(
        (nodes, expectedZoom) =>
          nodes.map((node) => {
            const box = node.getBoundingClientRect();
            const style = getComputedStyle(node);
            return {
              display: style.display,
              direction: style.flexDirection,
              cssHeight: style.height,
              physicalHeight: box.height,
              expectedPhysicalHeight: parseFloat(style.height) * expectedZoom,
              scrollWidth: node.scrollWidth,
              clientWidth: node.clientWidth,
            };
          }),
        zoom,
      );
      for (const row of geometry) {
        expect(row.display).toBe('flex');
        expect(row.direction).toBe('row');
        expect(row.cssHeight).toBe('32px');
        expect(Math.abs(row.physicalHeight - row.expectedPhysicalHeight)).toBeLessThanOrEqual(1);
        expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth);
      }

      for (const [title, status] of [
        ['Waiting unassigned task', 'waiting'],
        ['Review assigned task', 'review_required'],
        ['Complete unassigned task', 'complete'],
        ['Discussion needed task', 'discussion_needed'],
        ['Blocked assigned task', 'blocked'],
        ['Cancelled unassigned task', 'cancelled'],
      ] as const) {
        await expect(rows.filter({ hasText: title }).locator('xpath=..')).toHaveAttribute(
          'data-status',
          status,
        );
      }
      await expect(rows.filter({ hasText: 'Task not found: task-missing' })).toHaveCount(1);

      const longRow = rows.filter({ hasText: 'A very long assigned task title' });
      const longTitle = longRow.locator('[data-task-row-title]');
      const agentControl = longRow.locator('[data-task-agent-indicator]');
      await expect(longTitle).toHaveCSS('text-overflow', 'ellipsis');
      expect(await longTitle.evaluate((node) => node.scrollWidth > node.clientWidth)).toBeTruthy();
      const [titleBox, controlBox, rowBox] = await Promise.all([
        longTitle.boundingBox(),
        agentControl.boundingBox(),
        longRow.boundingBox(),
      ]);
      expect(titleBox!.x + titleBox!.width).toBeLessThanOrEqual(controlBox!.x + 0.5);
      expect(controlBox!.x + controlBox!.width).toBeLessThanOrEqual(
        rowBox!.x + rowBox!.width + 0.5,
      );

      await expect(rows.locator('[data-task-agent-indicator]')).toHaveCount(5);
      await expect(rows.locator('[data-task-row-assign]')).toHaveCount(4);
      await expect(rows.locator('button button')).toHaveCount(0);
    });
  }
}

test('keeps status, title, assign, and agent controls keyboard accessible', async ({ mount }) => {
  const component = await mount(OneRowTaskSurfaceHarness);
  const controls = [
    component.getByTitle('Status: waiting').first(),
    component.getByRole('button', { name: 'Waiting unassigned task' }),
    component.getByTitle('Assign to agent').first(),
    component.getByRole('button', { name: /Open agent Active task agent: Working/i }).first(),
  ];

  for (const control of controls) {
    await control.focus();
    await expect(control).toBeFocused();
  }
});

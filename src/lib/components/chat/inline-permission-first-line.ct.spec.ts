import { expect, test } from '../../../test/ct-test';
import InlinePermissionRequest from './InlinePermissionRequest.svelte';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

test('permission shield stays centered on the first question line', async ({ mount, page }) => {
  await page.setViewportSize({ width: 360, height: 600 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(InlinePermissionRequest, {
    props: {
      request: {
        requestId: 'audit-request',
        sessionId: 'audit-session',
        timestamp: 1,
        title: 'Approve external service access for this workspace and all following tasks',
        agentName: 'Design reviewer',
        options: [{ id: 'deny', label: 'Deny' }],
      },
    },
  });
  const root = page.locator('.inline-permission-request');
  await expect(root).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const delta = await root.evaluate((node) => {
    const label = node.querySelector('.type-body.font-medium')!;
    const box = label.getBoundingClientRect();
    const icon = node.querySelector('.first-line-icon svg')!.getBoundingClientRect();
    return Math.abs(
      icon.top +
        icon.height / 2 -
        box.top -
        Number.parseFloat(getComputedStyle(label).lineHeight) / 2,
    );
  });
  expect(delta).toBeLessThanOrEqual(1);
  if (process.env.MODAL_AUDIT_CAPTURE_DIR) {
    await mkdir(process.env.MODAL_AUDIT_CAPTURE_DIR, { recursive: true });
    await root.screenshot({
      path: join(process.env.MODAL_AUDIT_CAPTURE_DIR, 'permission-first-line-360.png'),
    });
  }
});

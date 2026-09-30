import { expect, test } from '../../../test/ct-test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import Harness from './__tests__/WorkspaceAvatarHarness.svelte';
for (const dark of [false, true]) {
  for (const width of [390, 960]) {
    test(`workspace avatar roles and connectivity ${dark ? 'dark' : 'light'} ${width}`, async ({
      mount,
      page,
    }) => {
      await page.setViewportSize({ width, height: 500 });
      await page.evaluate(
        (enabled) => document.documentElement.classList.toggle('dark', enabled),
        dark,
      );
      await mount(Harness);
      const surface = page.getByTestId('avatar-harness');
      const brightness = await surface.evaluate((element) => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d')!;
        context.fillStyle = getComputedStyle(element).backgroundColor;
        context.fillRect(0, 0, 1, 1);
        const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
        return (r + g + b) / 3;
      });
      if (dark) expect(brightness).toBeLessThan(128);
      else expect(brightness).toBeGreaterThan(128);
      await expect(
        page.getByRole('button', { name: 'owner · Host owner · Online', exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', {
          name: 'member · Host member · Online · Viewing this workspace',
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole('button', {
          name: 'guest-offline · Workspace guest · Offline',
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.locator('[data-presence-avatar="offline-host"]')).toHaveCount(0);
      const rings = page.locator('[data-presence-avatar]');
      await expect(rings).toHaveCount(4);
      expect(await page.locator('[data-presence-ring="guest"]').count()).toBe(2);
      const colors = await rings.evaluateAll((elements) =>
        elements.map((el) => getComputedStyle(el).boxShadow),
      );
      expect(new Set(colors.slice(0, 3)).size).toBe(3);
      await expect(
        page.locator('[data-presence-avatar="guest-offline"] [data-presence-status="offline"]'),
      ).toHaveCount(1);
      await page.getByRole('button', { name: 'owner · Host owner · Online', exact: true }).focus();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: /^member · Host member/ })).toBeFocused();
      if (process.env.AVATAR_CAPTURE_DIR) {
        const tooltips = page.locator('[data-tooltip-content]');
        await expect(tooltips.filter({ hasText: 'owner · Host owner · Online' })).toHaveCount(0);
        const memberTooltip = tooltips.filter({ hasText: 'member · Host member' });
        await expect(tooltips).toHaveCount(1);
        await expect(memberTooltip).toHaveText(
          'member · Host member · Online · Viewing this workspace',
        );
        await expect(memberTooltip).toBeVisible();
        await expect(memberTooltip).toHaveAttribute('data-state', 'instant-open');
        await expect
          .poll(() =>
            memberTooltip.evaluate(
              (element) =>
                getComputedStyle(element).opacity === '1' &&
                element
                  .getAnimations()
                  .every((animation) => !animation.pending && animation.playState === 'finished'),
            ),
          )
          .toBe(true);
        await mkdir(process.env.AVATAR_CAPTURE_DIR, { recursive: true });
        await page.screenshot({
          path: join(
            process.env.AVATAR_CAPTURE_DIR,
            `avatars-${dark ? 'dark' : 'light'}-${width}.png`,
          ),
        });
      }
      await page.keyboard.press('Enter');
      await expect(page.getByRole('status')).toHaveText('member');
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
      ).toBeLessThanOrEqual(1);
      await page.getByRole('button', { name: 'Disable Multiplayer', exact: true }).click();
      await expect(page.locator('[data-presence-avatar-stack]')).toHaveCount(0);
    });
  }
}

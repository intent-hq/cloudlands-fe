import { expect, test } from '../../../../test/ct-test';
import Form from './selected-repository-form.test-harness.svelte';

for (const width of [420, 1000]) {
  for (const provider of ['github', 'gitlab'] as const) {
    test(`${provider} selected form keeps branch keyboard interaction usable at ${width}px`, async ({
      mount,
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.route(
        /https:\/\/(github.com\/fixture-owner.png|git.example.test\/Forge\/uploads\/namespace.png)/,
        (route) =>
          route.fulfill({
            contentType: 'image/svg+xml',
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="16" fill="lightgray"/></svg>',
          }),
      );
      await mount(Form, {
        props: { provider },
        hooksConfig: {
          mockIpc: {
            'system:check-git': { success: true, data: { available: true } },
          },
        },
      });
      const form = page.getByTestId('selected-repository-form');
      const create = form.getByRole('button', { name: /Create workspace/ });
      await expect(create).toBeEnabled();
      await page.evaluate(() => document.fonts.ready);
      const branch = form.getByRole('button', { name: /trunk/ });
      const createBounds = (await create.boundingBox())!;
      const branchBounds = (await branch.boundingBox())!;
      if (width === 420) expect(createBounds.y).toBeGreaterThan(branchBounds.y);
      else
        expect(
          Math.abs(
            createBounds.y + createBounds.height / 2 - branchBounds.y - branchBounds.height / 2,
          ),
        ).toBeLessThanOrEqual(1);
      await page.screenshot({ path: testInfo.outputPath(`${provider}-${width}-ready.png`) });
      await branch.focus();
      await page.keyboard.press('Enter');
      const choice = page.getByRole('option', { name: 'release/next', exact: true });
      await expect(choice).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`${provider}-${width}-branch-menu.png`) });
      await choice.click();
      await expect(form.getByRole('button', { name: /release\/next/ })).toBeFocused();
      await expect(create).toBeEnabled();
      await expect.poll(() => form.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${provider}-${width}-changed.png`) });
    });
  }
}

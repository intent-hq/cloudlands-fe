import { expect, test, type Locator } from '@playwright/experimental-ct-svelte';
import ToolCallRunningStatusHost from './ToolCallRunningStatusHost.svelte';

const row = (host: Locator, name: string) => host.locator(`[data-row="${name}"]`);

async function expectRunningIdentityOnly(target: Locator) {
  await expect(target.locator('[data-tool-icon]')).toHaveClass(/animate-pulse/);
  await expect(target.locator('[data-operational-trailing]')).toHaveCount(0);
  await expect(target.getByTestId('tool-call-status')).toHaveCount(0);
  await expect(target.locator('[data-icon="spinner"]')).toHaveCount(0);
}

test('keeps tool status, layout, motion, and accessibility contracts', async ({ mount, page }) => {
  const component = await mount(ToolCallRunningStatusHost);

  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    await page.emulateMedia({ reducedMotion });
    for (const theme of ['light', 'dark'] as const) {
      for (const width of [280, 720]) {
        for (const zoom of [1, 2]) {
          await component.update({ props: { theme, width, zoom } });
          await expect
            .poll(() => component.evaluate((node) => node.classList.contains('dark')))
            .toBe(theme === 'dark');

          for (const name of ['generic-running', 'context-running']) {
            const target = row(component, name);
            await expectRunningIdentityOnly(target);
            expect(await target.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(
              true,
            );
            await expect(target.locator('[data-operational-summary]')).toHaveCSS(
              'text-overflow',
              'ellipsis',
            );
          }

          for (const name of ['generic-success', 'context-success']) {
            await expect(row(component, name).getByTestId('tool-call-status')).toHaveAttribute(
              'data-tool-status',
              'success',
            );
            await expect(row(component, name).getByRole('img')).toHaveAccessibleName('Success');
          }
          for (const name of ['generic-error', 'context-error']) {
            await expect(row(component, name).getByTestId('tool-call-status')).toHaveAttribute(
              'data-tool-status',
              'error',
            );
            await expect(row(component, name).getByRole('img')).toHaveAccessibleName('Failed');
          }

          await expect(
            row(component, 'generic-action').getByTestId('tool-call-note-link'),
          ).toBeVisible();
          await expect(component.locator('[data-operational-chevron]')).toHaveCount(0);
        }
      }
    }
  }

  const genericDisclosure = row(component, 'generic-running').getByTestId('tool-call-disclosure');
  await expect(genericDisclosure).toHaveAttribute('aria-expanded', 'false');
  await expect(genericDisclosure).toHaveAttribute('aria-controls', 'tool-details-generic-running');
  await genericDisclosure.press('Enter');
  await expect(genericDisclosure).toHaveAttribute('aria-expanded', 'true');
  await expect(component.locator('#tool-details-generic-running')).toBeVisible();

  const contextDisclosure = row(component, 'context-error').getByTestId(
    'context-engine-disclosure',
  );
  await expect(contextDisclosure).toHaveAttribute('aria-expanded', 'false');
  await expect(contextDisclosure).toHaveAttribute(
    'aria-controls',
    'context-engine-details-context-error',
  );
  await contextDisclosure.press('Space');
  await expect(contextDisclosure).toHaveAttribute('aria-expanded', 'true');
  await expect(component.getByTestId('context-engine-brand')).toBeVisible();
});

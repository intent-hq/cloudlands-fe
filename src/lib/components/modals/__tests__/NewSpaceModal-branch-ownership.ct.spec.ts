import { expect, test } from '../../../../test/ct-test';
import type { Locator } from '@playwright/test';
import Harness from './NewSpaceRepoChooserHarness.svelte';

async function expectReachable(control: Locator) {
  await control.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      control.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return Boolean(hit && element.contains(hit));
      }),
    )
    .toBe(true);
}

for (const { name, viewport } of [
  { name: 'desktop overlapping form', viewport: { width: 1100, height: 700 } },
  { name: 'short compact form', viewport: { width: 600, height: 440 } },
]) {
  test(`branch chooser stays usable above New Workspace: ${name}`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mount(Harness);
    const launcher = page.getByRole('button', { name: 'Open workspace form' });
    await launcher.click();
    const parent = page.getByRole('dialog', { name: 'New Workspace', exact: true });
    const branch = parent.getByRole('button', { name: /^Select a branch:/ });
    await branch.click();
    const chooser = page.getByRole('dialog', { name: 'What branch should we start from?' });
    const search = chooser.getByRole('combobox');
    await expectReachable(search);
    await expect(search).toBeFocused();
    await expect(search).toHaveAttribute('aria-busy', 'false');
    await search.fill('feature/task-29');
    const option = chooser.getByRole('option', { name: 'feature/task-29', exact: true });
    await expectReachable(option);
    await testInfo.attach('branch-menu-above-workspace', {
      body: await page.screenshot({ path: testInfo.outputPath('branch-menu.png') }),
      contentType: 'image/png',
    });
    await option.click();
    await expect(chooser).toHaveCount(0);
    await expect(page.getByTestId('initializer-selection')).toContainText(
      '"branch":"feature/task-29"',
    );
    await expect(parent).toBeVisible();
    await expect(branch).toBeFocused();

    await branch.press('Enter');
    await expect(search).toBeFocused();
    await search.fill('main');
    await search.press('Enter');
    await expect(chooser).toHaveCount(0);
    await expect(page.getByTestId('initializer-selection')).toContainText('"branch":"main"');
    await expect(branch).toBeFocused();

    await branch.press('Enter');
    await expect(search).toBeFocused();
    await search.press('Escape');
    await expect(chooser).toHaveCount(0);
    await expect(parent).toBeVisible();
    await expect(page.getByTestId('workspace-close-count')).toHaveText('0');
    await expect(branch).toBeFocused();
    await branch.press('Escape');
    await expect(parent).toHaveCount(0);
    await expect(page.getByTestId('workspace-close-count')).toHaveText('1');
    await expect(launcher).toBeFocused();
  });
}

test('standalone branch chooser keeps pointer selection and focus return', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 600 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(Harness, { props: { standalone: true } });
  const branch = page.getByRole('button', { name: /^Select a branch:/ });
  await branch.click();
  const chooser = page.getByRole('dialog', { name: 'What branch should we start from?' });
  const search = chooser.getByRole('combobox');
  await expectReachable(search);
  await expect(search).toHaveAttribute('aria-busy', 'false');
  await search.fill('feature/task-29');
  const option = chooser.getByRole('option', { name: 'feature/task-29', exact: true });
  await expectReachable(option);
  await option.click();
  await expect(chooser).toHaveCount(0);
  await expect(page.getByTestId('initializer-selection')).toContainText(
    '"branch":"feature/task-29"',
  );
  await expect(branch).toBeFocused();
  await branch.press('Enter');
  await expect(search).toBeFocused();
  await search.press('Escape');
  await expect(chooser).toHaveCount(0);
  await expect(branch).toBeFocused();
});

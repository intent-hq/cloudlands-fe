import { expect, test } from '../../../../test/ct-test';
import type { Locator } from '@playwright/test';
import Harness from './NewSpaceRepoChooserHarness.svelte';

async function expectPointerReachable(control: Locator) {
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

async function expectViewportGutter(popup: Locator) {
  await expect
    .poll(() =>
      popup.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          rect.left >= 8 &&
          rect.top >= 8 &&
          rect.right <= innerWidth - 8 &&
          rect.bottom <= innerHeight - 8 &&
          [
            [rect.left + 8, rect.top + 8],
            [rect.right - 8, rect.bottom - 8],
          ].every(([x, y]) => {
            const hit = document.elementFromPoint(x, y);
            return Boolean(hit && element.contains(hit));
          })
        );
      }),
    )
    .toBe(true);
}

for (const { name, viewport } of [
  { name: 'desktop overlapping form', viewport: { width: 1100, height: 700 } },
  { name: 'short compact form', viewport: { width: 600, height: 440 } },
]) {
  test(`repository chooser belongs to New Workspace: ${name}`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mount(Harness);
    const launcher = page.getByRole('button', { name: 'Open workspace form' });
    await launcher.click();
    const parent = page.getByRole('dialog', { name: 'New Workspace', exact: true });
    const repo = parent
      .getByTestId('initializer-pickers-fixture')
      .locator('button[aria-haspopup="dialog"]')
      .first();
    await repo.click();
    const chooser = page.getByRole('dialog', { name: 'What repo should we work on?' });
    await expectViewportGutter(chooser);
    // Exercise the pixels shared with the parent, not just the child area
    // extending beyond it. A body-portalled z40 popup can be DOM-visible yet
    // lose this hit test to the parent's z70 surface.
    await expect
      .poll(() =>
        chooser.evaluate((element) => {
          const parent = document.querySelector('[data-new-space-modal]')!;
          const childRect = element.getBoundingClientRect();
          const parentRect = parent.getBoundingClientRect();
          const left = Math.max(childRect.left, parentRect.left);
          const right = Math.min(childRect.right, parentRect.right);
          const top = Math.max(childRect.top, parentRect.top);
          const bottom = Math.min(childRect.bottom, parentRect.bottom);
          const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
          return right > left && bottom > top && Boolean(hit && element.contains(hit));
        }),
      )
      .toBe(true);

    const github = chooser.getByRole('tab', { name: 'Pick a repo', exact: true });
    await expectPointerReachable(github);
    await github.click();
    const search = chooser.getByRole('combobox');
    await expectPointerReachable(search);
    await search.click();
    await search.fill('no-matching-fixture-repository');
    await expect(search).toBeFocused();
    await expect(chooser.getByTestId('recent-repositories').getByRole('button')).toHaveCount(0);
    await expectViewportGutter(chooser);
    await testInfo.attach('owned-repository-chooser-empty-search', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    await search.press('Escape');
    await expect(chooser).toHaveCount(0);
    await expect(parent).toBeVisible();
    await expect(page.getByTestId('workspace-close-count')).toHaveText('0');
    await expect(repo).toBeFocused();
    await expect(page.getByTestId('initializer-selection')).toContainText(
      '"repoPath":"/fixture/app"',
    );

    await repo.press('Enter');
    const local = chooser.getByRole('tab', { name: 'Copy local repo', exact: true });
    await expectPointerReachable(local);
    await local.click();
    const tools = chooser
      .getByTestId('recent-repositories')
      .getByRole('button', { name: /^tools/ });
    await expectPointerReachable(tools);
    await testInfo.attach('owned-repository-chooser-local-selection', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await tools.click();
    await expect(chooser).toHaveCount(0);
    await expect(parent).toBeVisible();
    await expect(page.getByTestId('initializer-selection')).toContainText(
      '"repoPath":"/fixture/tools"',
    );
    await expect(repo).toBeFocused();
    await expect(page.getByTestId('workspace-close-count')).toHaveText('0');

    await repo.press('Escape');
    await expect(parent).toHaveCount(0);
    await expect(page.getByTestId('workspace-close-count')).toHaveText('1');
    await expect(launcher).toBeFocused();
  });
}

test('standalone repository chooser retains pointer selection, Escape and focus return', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 600 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(Harness, { props: { standalone: true } });
  const repo = page
    .getByTestId('initializer-pickers-fixture')
    .locator('button[aria-haspopup="dialog"]')
    .first();
  await repo.click();
  const chooser = page.getByRole('dialog', { name: 'What repo should we work on?' });
  await expectViewportGutter(chooser);
  const local = chooser.getByRole('tab', { name: 'Copy local repo', exact: true });
  await expectPointerReachable(local);
  await local.click();
  const tools = chooser.getByTestId('recent-repositories').getByRole('button', { name: /^tools/ });
  await expectPointerReachable(tools);
  await tools.click();
  await expect(chooser).toHaveCount(0);
  await expect(page.getByTestId('initializer-selection')).toContainText(
    '"repoPath":"/fixture/tools"',
  );
  await expect(repo).toBeFocused();
  await repo.press('Enter');
  await expect(chooser).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(chooser).toHaveCount(0);
  await expect(repo).toBeFocused();
});

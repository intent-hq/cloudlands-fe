import type { Locator, Page, TestInfo } from '@playwright/experimental-ct-svelte';
import { expect, test } from '../../test/ct-test';
import Preview from './home-integrations.preview.svelte';

// Failure contracts: misleading check verdicts, inaccessible disclosures, lost expansion
// after filtering, invalid renamed/add/remove patches, hidden fallback states, and a diff
// capturing vertical wheel input instead of the PR pane.
async function capture(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(name, {
    body: await page.screenshot({ path: `.demo-artifacts/home-pr-panel/${name}.png` }),
    contentType: 'image/png',
  });
}

async function expandCheckGroups(checks: Locator) {
  const groups = checks.locator('[data-home-pr-check-group]');
  for (let index = 0; index < (await groups.count()); index++) {
    const trigger = groups.nth(index).getByRole('button').first();
    if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  }
}

for (const theme of ['light', 'dark'] as const) {
  test(`PR checks disclose status groups with keyboard access in ${theme}`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme });
    await page.evaluate((value) => {
      document.documentElement.classList.remove('light', 'dark');
      document.documentElement.classList.add(value);
    }, theme);
    const component = await mount(Preview, { props: { scenario: 'checks-mixed' } });
    const checks = component.locator('[data-home-pr-checks]');
    const summary = checks.locator('[data-home-pr-checks-summary]');
    await expect(summary).toHaveAttribute('aria-expanded', 'false');
    await expect(checks.getByRole('button', { name: /^Pending/ })).toHaveCount(0);
    await capture(page, testInfo, `checks-overview-${theme}`);
    await summary.focus();
    await page.keyboard.press('Enter');
    await expect(summary).toHaveAttribute('aria-expanded', 'true');
    await expect(summary).toBeFocused();
    const groups = checks.locator('[data-home-pr-check-group]');
    for (let index = 0; index < (await groups.count()); index++) {
      await expect(groups.nth(index).getByRole('button').first()).toHaveAttribute(
        'aria-expanded',
        'true',
      );
    }
    await expect(checks.getByText('CI Gate', { exact: false })).toBeVisible();
    const pending = checks
      .locator('[data-home-pr-check-group="pending"]')
      .getByRole('button')
      .first();
    await pending.focus();
    await page.keyboard.press('Space');
    await expect(pending).toHaveAttribute('aria-expanded', 'false');
    await expect(checks.getByRole('button', { name: /^CI Gate/ })).toHaveCount(0);
    await expect(checks.getByText('Typecheck', { exact: false })).toBeVisible();
    await page.keyboard.press('Space');
    await expect(pending).toHaveAttribute('aria-expanded', 'true');
    await expect(checks.getByText('CI Gate', { exact: false })).toBeVisible();
    await expect(checks.getByText('Lint', { exact: false })).toBeVisible();
    await expect(checks.getByText('Integration tests', { exact: false })).toBeVisible();
    await expect(checks.getByText('Typecheck', { exact: false })).toBeVisible();
    await expect(checks.getByText('Release preview', { exact: false })).toBeVisible();
    await capture(page, testInfo, `checks-expanded-${theme}`);
    await summary.click();
    await expect(checks.getByRole('button', { name: /^Pending/ })).toHaveCount(0);
    await summary.click();
    await expect(checks.getByText('CI Gate', { exact: false })).toBeVisible();
  });

  test(`PR file overview keeps long diffs in the pane scroll in ${theme}`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme });
    await page.evaluate((value) => {
      document.documentElement.classList.remove('light', 'dark');
      document.documentElement.classList.add(value);
    }, theme);
    const component = await mount(Preview, { props: { scenario: 'files-long' } });
    await component.getByRole('tab', { name: 'Code', exact: true }).click();
    const code = component.locator('[data-home-pr-code]');
    const body = component.locator('.integration-detail-body');
    const first = code.locator('[data-home-pr-file="src/features/home/HomePullCode.svelte"]');
    const toggle = first.locator('[data-home-pr-file-toggle]');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(code.locator('[data-line]')).toHaveCount(0);
    await capture(page, testInfo, `files-overview-${theme}`);
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(first.locator('[data-line][data-line-type="change-addition"]')).toHaveCount(240);
    const scrollOwners = await body.evaluate((root) => {
      const nodes: Element[] = [root];
      const walk = (node: Element) => {
        for (const child of node.children) {
          nodes.push(child);
          walk(child);
        }
        if (node.shadowRoot) {
          for (const child of node.shadowRoot.children) {
            nodes.push(child);
            walk(child);
          }
        }
      };
      walk(root);
      return nodes
        .filter((node) => {
          const style = getComputedStyle(node);
          return (
            /auto|scroll/.test(style.overflowY) &&
            node.clientHeight > 0 &&
            node.scrollHeight > node.clientHeight + 1
          );
        })
        .map((node) => ({
          isDetailPane: node === root,
          height: node.clientHeight,
          contentHeight: node.scrollHeight,
        }));
    });
    expect(scrollOwners).toHaveLength(1);
    expect(scrollOwners[0]?.isDetailPane).toBe(true);
    const diff = first.locator('.pure-diff-content');
    const codeSurface = first.locator('[data-code]');
    const horizontal = await codeSurface.evaluate((node) => ({
      width: node.clientWidth,
      contentWidth: node.scrollWidth,
    }));
    expect(horizontal.contentWidth).toBeGreaterThan(horizontal.width);
    const box = await codeSurface.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + 100, Math.min(box!.y + 70, 650));
    await page.mouse.wheel(450, 0);
    await expect.poll(() => codeSurface.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
    const beforeScroll = await body.evaluate((node) => node.scrollTop);
    await page.mouse.wheel(0, 450);
    await expect.poll(() => body.evaluate((node) => node.scrollTop)).toBeGreaterThan(beforeScroll);
    expect(await diff.evaluate((node) => node.scrollTop)).toBe(0);
    await testInfo.attach(`diff-scroll-${theme}`, {
      body: JSON.stringify(
        {
          scrollOwners,
          horizontal,
          wheelScrollLeft: await codeSurface.evaluate((node) => node.scrollLeft),
          wheelScrollTop: await body.evaluate((node) => node.scrollTop),
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    await body.evaluate((node) => {
      node.scrollTop = 0;
    });
    await capture(page, testInfo, `files-expanded-${theme}`);

    const search = code.getByRole('searchbox');
    await search.fill('renamed file');
    const renamed = code.locator('[data-home-pr-file="src/features/home/renamed file.ts"]');
    await renamed.locator('[data-home-pr-file-toggle]').click();
    await expect(renamed.locator('[data-line][data-line-type="change-addition"]')).toHaveCount(1);
    await expect(renamed.locator('[data-line][data-line-type="change-deletion"]')).toHaveCount(1);
    await search.fill('');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(renamed.locator('[data-home-pr-file-toggle]')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await search.fill('no-match');
    await expect(code.locator('[data-home-pr-file-toggle]')).toHaveCount(0);
    await search.fill('README');
    await code.locator('[data-home-pr-file-toggle]').click();
    await expect(code.locator('[data-line][data-line-type="change-addition"]')).toHaveCount(1);
    await search.fill('new-file');
    await code.locator('[data-home-pr-file-toggle]').click();
    await expect(code.locator('[data-line][data-line-type="change-addition"]')).toHaveCount(1);
    await expect(code.locator('[data-line][data-line-type="change-deletion"]')).toHaveCount(0);
    await search.fill('removed-file');
    await code.locator('[data-home-pr-file-toggle]').click();
    await expect(code.locator('[data-line][data-line-type="change-deletion"]')).toHaveCount(1);
    await expect(code.locator('[data-line][data-line-type="change-addition"]')).toHaveCount(0);
    await search.fill('preview.png');
    await code.locator('[data-home-pr-file-toggle]').click();
    await expect(code.locator('[data-home-pr-file-diff]')).toBeVisible();
    await expect(code.locator('[data-line]')).toHaveCount(0);
    await capture(page, testInfo, `file-unavailable-${theme}`);
  });
}

test('PR files remain operable in a narrow, short pane', async ({ mount, page }, testInfo) => {
  await page.setViewportSize({ width: 420, height: 550 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const component = await mount(Preview, { props: { scenario: 'files-long', height: 500 } });
  await component.getByRole('tab', { name: 'Code', exact: true }).click();
  const code = component.locator('[data-home-pr-code]');
  await code.getByRole('searchbox').fill('a-very-long-filename');
  const toggle = code.locator('[data-home-pr-file-toggle]');
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(code.locator('[data-line][data-line-type="change-addition"]')).toHaveCount(1);
  const containment = await code.evaluate((root) => {
    const row = root.querySelector('[data-home-pr-file-toggle]')!;
    const body = root.closest('.integration-detail-body')!;
    const rowBox = row.getBoundingClientRect();
    const bodyBox = body.getBoundingClientRect();
    return {
      left: rowBox.left >= bodyBox.left,
      right: rowBox.right <= bodyBox.right,
      bodyWidth: body.clientWidth,
      bodyContentWidth: body.scrollWidth,
    };
  });
  expect(containment.left && containment.right).toBe(true);
  expect(containment.bodyContentWidth).toBeLessThanOrEqual(containment.bodyWidth + 1);
  await capture(page, testInfo, 'files-narrow-short');
  await testInfo.attach('narrow-containment', {
    body: JSON.stringify(containment, null, 2),
    contentType: 'application/json',
  });
});

for (const scenario of [
  'checks-passed',
  'checks-neutral',
  'checks-cancelled',
  'checks-empty',
  'checks-loading',
  'checks-error',
]) {
  test(`PR checks keep ${scenario} results honest`, async ({ mount, page }, testInfo) => {
    await page.setViewportSize({ width: 720, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const component = await mount(Preview, { props: { scenario } });
    const checks = component.locator('[data-home-pr-checks]');
    const summary = checks.locator('[data-home-pr-checks-summary]');
    if (scenario === 'checks-empty' || scenario === 'checks-loading') {
      await expect(summary).toHaveCount(0);
      if (scenario === 'checks-loading')
        await expect(checks.locator('[data-home-loading]')).toBeVisible();
    } else {
      await summary.click();
      await expandCheckGroups(checks);
      await expect(checks.locator('[data-home-pr-check-group]')).not.toHaveCount(0);
      if (scenario === 'checks-error') await expect(checks.getByRole('alert')).toBeVisible();
      if (scenario === 'checks-cancelled')
        await expect(checks.locator('[data-home-pr-check-group="passed"]')).toHaveCount(0);
    }
    await capture(page, testInfo, scenario);
  });
}

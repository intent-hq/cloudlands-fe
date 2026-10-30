import { expect, test } from '../../../../../test/ct-test';
import Preview from '../changes-summary.preview.svelte';

test('keeps workspace PRs available when browsing a submodule', async ({ mount, page }) => {
  await page.setViewportSize({ width: 420, height: 800 });
  await mount(Preview, { props: { prs: 'multiple', secondaryFiles: true } });
  const prs = page.locator('[data-workspace-pull-requests] [data-pr-identity]');
  await expect(prs).toHaveCount(5);
  const identities = await prs.evaluateAll((rows) =>
    rows.map((row) => row.getAttribute('data-pr-identity')),
  );
  await page.getByRole('combobox', { name: 'Select git root' }).click();
  await page.getByRole('option', { name: /^packages\/component/ }).click();
  await expect(page.locator('[data-testid="secondary-root-changes-view"]')).toBeVisible();
  await expect(prs).toHaveCount(5);
  expect(
    await prs.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-pr-identity'))),
  ).toEqual(identities);
  await prs.last().focus();
  await expect(prs.last()).toBeFocused();
  await expect(prs.last()).toBeInViewport();
});

test('owner metadata cannot enable branch editing before connection admission', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mount(Preview, { props: { admittedOwner: false } });
  const summary = page.locator('[data-branch-summary]');
  await expect(summary).toBeVisible();
  const working = summary.locator('[data-branch-field="working"]');
  await working.getByRole('button').focus();
  await page.keyboard.press('Enter');
  await expect(working.getByRole('button')).toBeFocused();
  await expect(working.getByRole('textbox')).toHaveCount(0);
  const target = summary.locator('[data-branch-field="target"]');
  await expect(target.getByRole('textbox')).toHaveAttribute('readonly', '');
  await expect(target.getByRole('button', { name: /Select a branch/ })).toHaveCount(0);
});

for (const { width, locked } of [
  { width: 360, locked: false },
  { width: 280, locked: true },
]) {
  test(`branch fields remain usable at ${width}px with ${locked ? 'locked' : 'selectable'} target`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mount(Preview, { props: { locked } });
    const summary = page.locator('[data-branch-summary]');
    await expect(summary).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const geometry = await summary.evaluate((root) => {
      const box = root.getBoundingClientRect();
      const controls = [...root.querySelectorAll('button,input')].map((node) => {
        const r = node.getBoundingClientRect();
        return {
          left: r.left,
          right: r.right,
        };
      });
      return { left: box.left, right: box.right, controls };
    });
    await testInfo.attach('branch-field-geometry', {
      body: JSON.stringify(geometry, null, 2),
      contentType: 'application/json',
    });
    await testInfo.attach('branch-fields', {
      body: await summary.screenshot(),
      contentType: 'image/png',
    });
    for (const control of geometry.controls) {
      expect(control.left).toBeGreaterThanOrEqual(geometry.left);
      expect(control.right).toBeLessThanOrEqual(geometry.right);
    }
    const working = summary.locator('[data-branch-field="working"]');
    await working.getByRole('button').click({ trial: true });
    await working.getByRole('button').focus();
    await page.keyboard.press('Enter');
    const input = working.getByRole('textbox');
    await expect(input).toBeFocused();
    await expect(input).toBeInViewport({ ratio: 1 });
    await input.fill('feature/cancelled-draft');
    await page.keyboard.press('Escape');
    await expect(input).toHaveCount(0);
    await expect(working.getByRole('button')).not.toContainText('cancelled-draft');
    const target = summary.locator('[data-branch-field="target"]');
    if (locked) {
      await expect(target.getByRole('textbox')).toHaveAttribute('readonly', '');
      await expect(target.getByRole('combobox')).toHaveCount(0);
    } else {
      const trigger = target
        .getByRole('button', { name: /Select a branch/ })
        .and(target.locator('[aria-haspopup="dialog"]'));
      await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
      await trigger.click({ trial: true });
      await trigger.focus();
      await page.keyboard.press('Enter');
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByRole('dialog').getByRole('combobox')).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await expect(trigger).toBeFocused();
    }
    const changes = page.getByRole('tabpanel', { name: 'Changes', exact: true });
    const refresh = changes.getByRole('button', { name: 'Refresh git status', exact: true });
    await refresh.focus();
    await page.keyboard.press('Enter');
    await expect(refresh).toBeDisabled();
    await expect(refresh).toBeEnabled();
    const root = page.getByRole('combobox', { name: 'Select git root' });
    await root.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('option', { name: 'packages/component' }).click();
    await expect(page.getByTestId('secondary-root-changes-view')).toBeVisible();
    await expect(refresh).toHaveCount(1);
    await expect(refresh).toBeEnabled();
  });
}

test('secondary file buttons retain native and modifier activation inside the Changes panel', async ({
  mount,
  page,
}) => {
  const actions: Array<{ type: string; payload: unknown }> = [];
  await mount(Preview, {
    props: {
      secondaryFiles: true,
      onNavigation: (action: { type: string; payload: unknown }) => actions.push(action),
    },
  });
  await page.getByRole('combobox', { name: 'Select git root' }).click();
  await page.getByRole('option', { name: 'packages/component' }).click();
  const file = page.getByTestId('secondary-root-file-open').filter({ hasText: 'collision.md' });
  const tracked = page.getByTestId('secondary-root-file-open').filter({ hasText: 'tracked.txt' });
  await file.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => actions.length).toBe(1);
  expect(actions[0]).toMatchObject({
    type: 'workspaceNavigation/openWorkspaceFile',
    payload: [
      'changes-summary-preview',
      '/preview/workspace/packages/component/collision.md',
      { gitRootId: 'summary-root', gitRootPath: '/preview/workspace/packages/component' },
    ],
  });
  await page.keyboard.press('Space');
  await expect.poll(() => actions.length).toBe(2);
  expect(actions[1]).toEqual(actions[0]);
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect.poll(() => actions.length).toBe(3);
  expect(actions[2]).toMatchObject({
    payload: [expect.anything(), expect.anything(), { openInAdjacentPanel: true }],
  });
  await tracked.focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => actions.length).toBe(4);
  expect(actions[3].type).toBe('workspaceNavigation/openWorkspaceDiff');
  await tracked.click({ modifiers: ['ControlOrMeta'] });
  await expect.poll(() => actions.length).toBe(5);
});

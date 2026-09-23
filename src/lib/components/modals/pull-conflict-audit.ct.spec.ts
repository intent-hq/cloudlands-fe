import { expect, test } from '../../../test/ct-test';
import PullConflictDialog from './PullConflictDialog.svelte';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

test('pull recovery editor menu wraps long names and keeps icons on the first line', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 600 });
  await mount(PullConflictDialog, {
    props: {
      open: true,
      error: 'Merge conflict in src/feature.ts',
      staticData: {
        editors: [
          {
            id: 'fixture-editor',
            name: 'A development editor with an unusually long application name',
            shortLabel: 'Editor',
            appName: 'Fixture',
            category: 'ide',
            handlerType: 'generic',
            priority: 1,
            installed: true,
          },
        ],
      },
    },
  });
  await page.getByRole('button', { name: 'Open in...', exact: true }).click();
  const editor = page.getByRole('button', {
    name: 'A development editor with an unusually long application name',
    exact: true,
  });
  await expect(editor).toBeVisible();
  const geometry = await editor.evaluate((node) => {
    const label = node.querySelector('[data-editor-name]')!;
    const box = label.getBoundingClientRect();
    const icon = node.querySelector('svg')!.getBoundingClientRect();
    const lineHeight = Number.parseFloat(getComputedStyle(label).lineHeight);
    return {
      delta: Math.abs(icon.top + icon.height / 2 - box.top - lineHeight / 2),
      lines: box.height / lineHeight,
      overflow: node.scrollWidth - node.clientWidth,
    };
  });
  expect(geometry.delta).toBeLessThanOrEqual(1);
  expect(geometry.lines).toBeGreaterThan(1);
  expect(geometry.overflow).toBeLessThanOrEqual(1);
  if (process.env.MODAL_AUDIT_CAPTURE_DIR) {
    await mkdir(process.env.MODAL_AUDIT_CAPTURE_DIR, { recursive: true });
    await page.screenshot({
      path: join(process.env.MODAL_AUDIT_CAPTURE_DIR, 'pull-editor-menu-light-360.png'),
    });
  }
});

for (const [errorType, error] of [
  ['unstaged-changes', 'Cannot pull: you have unstaged changes.'],
  ['stash-conflict', 'Stash pop conflict; changes are saved in the stash.'],
  ['merge-conflict', 'CONFLICT (content): Merge conflict in src/feature.ts'],
  ['unknown', 'Unable to reach the remote repository.'],
] as const) {
  test(`pull ${errorType} preserves resolution intent and supports Escape`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 600 });
    let resolution: unknown;
    let canceled = 0;
    const props = {
      open: true,
      staticData: { editors: [] },
      error,
      repoPath: '/fixture/repository',
      branchName: 'main',
      onCreateWorkspace: (value: unknown) => {
        resolution = value;
      },
      onCancel: () => {
        canceled++;
      },
    };
    const component = await mount(PullConflictDialog, { props });
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.getByRole('button', { name: 'Create Workspace', exact: true }).click();
    await expect.poll(() => resolution).toEqual({ resolveConflicts: true, errorType });
    await expect(dialog).toHaveCount(0);
    await component.unmount();
    await mount(PullConflictDialog, { props });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect.poll(() => canceled).toBe(1);
    await expect(dialog).toHaveCount(0);
  });
}

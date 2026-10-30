import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '../../../test/ct-test';
import DockRailPreview from './dock-rail.preview.svelte';
import { dockRailPreview } from './dock-rail.preview-fixtures';

const ARTIFACTS = resolve(process.cwd(), '../../.intent/artifacts');

test('overview rows show org/repo alone, without the status message', async ({ mount, page }) => {
  await page.setViewportSize({ width: 720, height: 640 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  const props = dockRailPreview.states.notch.props;
  const workspaces = props.workspaces.map((item, index) =>
    index === 0
      ? {
          ...item,
          workspace: {
            ...item.workspace,
            statusMessage:
              'Waiting on the release checks to finish before tagging the next build for review',
          },
        }
      : item,
  );
  const component = await mount(DockRailPreview, { props: { ...props, workspaces } });
  await component.getByTestId('dock-drag-handle').hover();
  await expect(component.getByTestId('dock-shell')).toHaveAttribute('data-reveal', '1');
  const overview = component.getByTestId('dock-overview');
  await mkdir(ARTIFACTS, { recursive: true });
  await overview.screenshot({ path: resolve(ARTIFACTS, 'dock-overview-repo.png') });

  const first = workspaces[0].workspace;
  const row = overview.locator(`[data-dock-row][data-workspace-id="${first.id}"]`);
  const repo = row.locator('[data-dock-row-repo]');
  await expect(repo).toHaveText(`${first.repositoryOwner}/${first.repositoryName}`);
  // A row with a repository shows only the repository: the status message is not previewed.
  await expect(row.locator('[data-dock-row-message]')).toHaveCount(0);
  const layout = await row.evaluate((element) => {
    const repoNode = element.querySelector<HTMLElement>('[data-dock-row-repo]')!;
    return {
      repoWhole: repoNode.scrollWidth <= repoNode.clientWidth,
      rowHeight: element.getBoundingClientRect().height,
    };
  });
  expect(layout).toEqual({ repoWhole: true, rowHeight: 52 });
  // The Assistant row has no repository and keeps its status line.
  const assistant = overview.locator('[data-dock-row][data-workspace-id="dock:assistant"]');
  await expect(assistant.locator('[data-dock-row-repo]')).toHaveCount(0);
});

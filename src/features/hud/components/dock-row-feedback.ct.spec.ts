import { resolve } from 'node:path';
import { expect, test } from '../../../test/ct-test';
import DockRailPreview from './dock-rail.preview.svelte';
import { dockRailPreview } from './dock-rail.preview-fixtures';

test('compact header shows the same status dots and counts as the rows', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 640 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  const props = dockRailPreview.states.notch.props;
  // One in-progress and three unread workspaces, as the user saw in the live notch.
  const base = props.workspaces[0];
  const make = (id: string, workspace: Partial<typeof base.workspace>) => ({
    ...base,
    workspace: {
      ...base.workspace,
      id: `${base.workspace.id}-${id}` as typeof base.workspace.id,
      ...workspace,
    },
  });
  const items = [
    make('running', { displayStatus: 'in_progress', attention: 'none' }),
    ...[1, 2, 3].map((n) => make(`unread-${n}`, { displayStatus: 'idle', attention: 'unread' })),
  ];
  const component = await mount(DockRailPreview, { props: { ...props, workspaces: items } });
  const header = component.getByTestId('dock-update-count');
  // One glyph per status present, no numbers; the counts live in the accessible label.
  await expect(header.locator('[data-status-group]')).toHaveCount(2);
  await expect(header).toHaveText('');
  await expect(header).toHaveAccessibleName(/1.*3/);
  const shell = component.getByTestId('dock-shell');
  await expect(shell).toHaveAttribute('data-expanded', 'false');
  const box = await shell.boundingBox();
  if (!box) throw new Error('Missing shell bounds');
  await page.screenshot({
    path: resolve(process.cwd(), '../../.intent/artifacts/dock-header-status-groups.png'),
    clip: {
      x: box.x - 12,
      y: Math.max(0, box.y - 12),
      width: box.width + 24,
      height: box.height + 24,
    },
  });
  const headerGroups = await header.locator('[data-status-group]').evaluateAll((groups) =>
    groups.map((group) => ({
      status: group.getAttribute('data-status-group'),
      count: Number(group.getAttribute('data-status-count')),
    })),
  );
  // Oracle: the expanded rows' own workspace statuses (carried by their avatars).
  await component.getByTestId('dock-drag-handle').hover();
  await expect(shell).toHaveAttribute('data-reveal', '1');
  const rowStatuses = await component
    .locator('[data-dock-row] [data-dock-workspace-avatar][data-workspace-status]')
    .evaluateAll((badges) => badges.map((badge) => badge.getAttribute('data-workspace-status')));
  const rowCounts = headerGroups.map(({ status }) => ({
    status,
    count: rowStatuses.filter((value) => value === status).length,
  }));
  expect(headerGroups).toEqual(rowCounts);
  expect(headerGroups.reduce((sum, group) => sum + group.count, 0)).toBe(rowStatuses.length);
});

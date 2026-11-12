import { expect, test } from '../../../test/ct-test';
import DockRailPreview from './dock-rail.preview.svelte';
import { dockRailPreview } from './dock-rail.preview-fixtures';

test('compact header status counts match accessible row descriptions', async ({
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
    path: test.info().outputPath('dock-header-status-groups.png'),
    clip: {
      x: box.x - 12,
      y: Math.max(0, box.y - 12),
      width: box.width + 24,
      height: box.height + 24,
    },
  });
  await test.info().attach('dock-header-status-groups.png', {
    path: test.info().outputPath('dock-header-status-groups.png'),
    contentType: 'image/png',
  });
  const headerGroups = await header.locator('[data-status-group]').evaluateAll((groups) =>
    groups.map((group) => ({
      status: group.getAttribute('data-status-group'),
      count: Number(group.getAttribute('data-status-count')),
    })),
  );
  expect(headerGroups).toEqual([
    { status: 'in_progress', count: 1 },
    { status: 'unread', count: 3 },
  ]);
  // Repository avatars identify rows; their accessible descriptions carry the statuses.
  await component.getByTestId('dock-drag-handle').hover();
  await expect(shell).toHaveAttribute('data-reveal', '1');
  const rows = component
    .getByRole('grid', { name: 'Active spaces', exact: true })
    .locator('[data-dock-row]');
  await expect(rows).toHaveCount(4);
  for (const [index, item] of items.entries()) {
    await expect(
      rows.and(component.locator(`[data-workspace-id="${item.workspace.id}"]`)),
    ).toHaveAccessibleDescription(index === 0 ? /In progress$/ : /Unread$/);
  }
  const descriptions = await rows.evaluateAll((buttons) =>
    buttons.map((button) =>
      (button.getAttribute('aria-describedby') ?? '')
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    ),
  );
  const rowCounts = [
    {
      status: 'in_progress',
      count: descriptions.filter((text) => /In progress$/.test(text)).length,
    },
    { status: 'unread', count: descriptions.filter((text) => /Unread$/.test(text)).length },
  ];
  expect(headerGroups).toEqual(rowCounts);
  expect(headerGroups.reduce((sum, group) => sum + group.count, 0)).toBe(4);
  expect(rowCounts.reduce((sum, group) => sum + group.count, 0)).toBe(descriptions.length);
});

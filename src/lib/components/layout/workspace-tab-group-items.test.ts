import { describe, expect, it } from 'vitest';
import type { WorkspaceTabGroup } from '$store/renderer/slices/tab-state/tab-groups';
import {
  buildWorkspaceTabStripItems,
  getWorkspaceTabGroupToggleTarget,
} from './workspace-tab-group-items';

const groups: WorkspaceTabGroup[] = [
  { id: 'g', name: 'G', color: 'blue', workspaceIds: ['b', 'c'], lastActiveWorkspaceId: 'c' },
  { id: 'h', name: '', color: 'pink', workspaceIds: ['e'] },
];
const order = ['a', 'b', 'c', 'd', 'e'];

const describeItems = (openGroupId: string | null) =>
  buildWorkspaceTabStripItems(order, groups, openGroupId).map((item) =>
    item.kind === 'group'
      ? `[${item.group.id}${item.open ? ' open' : ''}]`
      : `${item.workspaceId}${item.group ? `:${item.group.edge}` : ''}`,
  );

describe('buildWorkspaceTabStripItems', () => {
  it('shows only the open group tabs and a chip for every group', () => {
    expect(describeItems('g')).toEqual(['a', '[g open]', 'b:middle', 'c:end', 'd', '[h]']);
  });

  it('hides the tabs of every group when none is open', () => {
    expect(describeItems(null)).toEqual(['a', '[g]', 'd', '[h]']);
  });
});

describe('getWorkspaceTabGroupToggleTarget', () => {
  it('opens a collapsed group at its last selected tab', () => {
    expect(getWorkspaceTabGroupToggleTarget(order, groups, 'g', 'a')).toBe('c');
  });

  it('collapses the open group by selecting the next tab outside it', () => {
    expect(getWorkspaceTabGroupToggleTarget(order, groups, 'g', 'b')).toBe('d');
  });

  it('cannot collapse a group that holds every tab', () => {
    const all: WorkspaceTabGroup[] = [{ id: 'g', name: '', color: 'blue', workspaceIds: ['a'] }];
    expect(getWorkspaceTabGroupToggleTarget(['a'], all, 'g', 'a')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import type { WorkspaceTabGroup } from '$store/renderer/slices/tab-state/tab-groups';
import {
  buildWorkspaceTabStripItems,
  resolveWorkspaceTabGroupToggle,
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

describe('resolveWorkspaceTabGroupToggle', () => {
  const toggle = (groupId: string, current: string, open: string | null) =>
    resolveWorkspaceTabGroupToggle(order, groups, groupId, current, open);

  it('opens a collapsed group without moving the selection off an ungrouped tab', () => {
    expect(toggle('g', 'a', null)).toEqual({ openGroupId: 'g', selectWorkspaceId: null });
  });

  it('selects the opened group tab when the current tab would be hidden', () => {
    expect(toggle('g', 'e', 'h')).toEqual({ openGroupId: 'g', selectWorkspaceId: 'c' });
  });

  it('collapses an open group that does not hold the current tab', () => {
    expect(toggle('g', 'a', 'g')).toEqual({ openGroupId: null, selectWorkspaceId: null });
  });

  it('collapses the group of the current tab by selecting the next tab outside it', () => {
    expect(toggle('g', 'b', 'g')).toEqual({ openGroupId: null, selectWorkspaceId: 'd' });
  });

  it('cannot collapse a group that holds every tab', () => {
    const all: WorkspaceTabGroup[] = [{ id: 'g', name: '', color: 'blue', workspaceIds: ['a'] }];
    expect(resolveWorkspaceTabGroupToggle(['a'], all, 'g', 'a', 'g')).toBeNull();
  });
});

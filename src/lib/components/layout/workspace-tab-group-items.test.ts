import { describe, expect, it } from 'vitest';
import type { WorkspaceTabGroup } from '$store/renderer/slices/tab-state/tab-groups';
import {
  buildWorkspaceTabStripItems,
  getReleasedWorkspaceTabGroupMove,
  layoutWorkspaceTabStrip,
  proposeWorkspaceStripDragOrder,
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
      : `${item.workspaceId}${item.group ? `:${item.hidden ? 'hidden' : item.group.edge}` : ''}`,
  );

describe('buildWorkspaceTabStripItems', () => {
  it('shows only the open group tabs and a chip for every group', () => {
    expect(describeItems('g')).toEqual([
      'a',
      '[g open]',
      'b:middle',
      'c:end',
      'd',
      '[h]',
      'e:hidden',
    ]);
  });

  it('hides the tabs of every group when none is open', () => {
    expect(describeItems(null)).toEqual([
      'a',
      '[g]',
      'b:hidden',
      'c:hidden',
      'd',
      '[h]',
      'e:hidden',
    ]);
  });
});

describe('layoutWorkspaceTabStrip drag items', () => {
  it('uses collapsed chips as ordering boundaries while keeping them out of the tab list', () => {
    const layout = layoutWorkspaceTabStrip(order, groups, null, null);

    expect(layout.dragItems.map((item) => item.key)).toEqual([
      'a',
      'tab-group:g',
      'd',
      'tab-group:h',
    ]);
    expect(layout.tabIds).toEqual(['a', 'd']);
  });

  it('uses individual members of the open group without duplicating its header as a boundary', () => {
    const layout = layoutWorkspaceTabStrip(order, groups, 'g', null);

    expect(layout.dragItems.map((item) => item.key)).toEqual(['a', 'b', 'c', 'd', 'tab-group:h']);
    expect(layout.tabIds).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('proposeWorkspaceStripDragOrder for a tab', () => {
  const propose = (
    fullOrder: string[],
    tabGroups: WorkspaceTabGroup[],
    draggedId: string,
    insertionIndex: number,
    openGroupId: string | null = null,
  ) => {
    const { dragItems } = layoutWorkspaceTabStrip(fullOrder, tabGroups, openGroupId, null);
    return proposeWorkspaceStripDragOrder(
      dragItems,
      fullOrder,
      tabGroups,
      draggedId,
      insertionIndex,
    );
  };

  it.each([
    { placement: 'before', insertionIndex: 1, expected: ['a', 'd', 'b', 'c'] },
    { placement: 'after', insertionIndex: 2, expected: ['a', 'b', 'c', 'd'] },
  ])('drops the trailing tab $placement a collapsed chip', ({ insertionIndex, expected }) => {
    expect(propose(['a', 'b', 'c', 'd'], [groups[0]], 'd', insertionIndex)).toEqual(expected);
  });

  it.each([
    { placement: 'before', insertionIndex: 0, expected: ['a', 'b', 'c', 'd'] },
    { placement: 'after', insertionIndex: 1, expected: ['b', 'c', 'a', 'd'] },
  ])('drops the leading tab $placement a collapsed chip', ({ insertionIndex, expected }) => {
    expect(propose(['a', 'b', 'c', 'd'], [groups[0]], 'a', insertionIndex)).toEqual(expected);
  });

  const collapsedGroups: WorkspaceTabGroup[] = [
    { id: 'g', name: '', color: 'blue', workspaceIds: ['b', 'c'] },
    { id: 'h', name: '', color: 'pink', workspaceIds: ['e', 'f'] },
  ];

  it.each([
    { placement: 'before both groups', insertionIndex: 0, expected: ['a', 'b', 'c', 'e', 'f'] },
    { placement: 'between the groups', insertionIndex: 1, expected: ['b', 'c', 'a', 'e', 'f'] },
    { placement: 'after both groups', insertionIndex: 2, expected: ['b', 'c', 'e', 'f', 'a'] },
  ])('moves the only visible tab $placement', ({ insertionIndex, expected }) => {
    expect(propose(['b', 'c', 'e', 'f', 'a'], collapsedGroups, 'a', insertionIndex)).toEqual(
      expected,
    );
  });

  it('moves a leading tab after the last member of a trailing collapsed group', () => {
    expect(propose(['a', 'b', 'c'], [groups[0]], 'a', 1)).toEqual(['b', 'c', 'a']);
  });

  it('allows a drop between the visible members of the open group', () => {
    expect(propose(order, groups, 'a', 1, 'g')).toEqual(['b', 'a', 'c', 'd', 'e']);
  });

  it('moves an open group member past a collapsed group without splitting its hidden members', () => {
    expect(propose(['a', 'b', 'c', 'e', 'f'], collapsedGroups, 'c', 3, 'g')).toEqual([
      'a',
      'b',
      'e',
      'f',
      'c',
    ]);
  });

  it.each([
    { placement: 'first', draggedId: 'd', insertionIndex: 0, expected: ['d', 'a', 'b', 'c'] },
    { placement: 'middle', draggedId: 'a', insertionIndex: 2, expected: ['b', 'c', 'a', 'd'] },
    { placement: 'last', draggedId: 'a', insertionIndex: 3, expected: ['b', 'c', 'd', 'a'] },
  ])(
    'keeps ungrouped ordering with Labs off when dropping $placement',
    ({ draggedId, insertionIndex, expected }) => {
      expect(propose(['a', 'b', 'c', 'd'], [], draggedId, insertionIndex)).toEqual(expected);
    },
  );

  it('can return to the original slot using the drag-start boundaries', () => {
    const fullOrder = ['a', 'b', 'c', 'd'];
    const { dragItems } = layoutWorkspaceTabStrip(fullOrder, [groups[0]], null, null);

    expect(proposeWorkspaceStripDragOrder(dragItems, fullOrder, [groups[0]], 'd', 1)).toEqual([
      'a',
      'd',
      'b',
      'c',
    ]);
    expect(proposeWorkspaceStripDragOrder(dragItems, fullOrder, [groups[0]], 'd', 2)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
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

describe('dragging a collapsed group', () => {
  const { dragItems } = layoutWorkspaceTabStrip(order, groups, null, null);

  it('moves the whole group to the drop slot', () => {
    const keys = dragItems.map((item) => item.key);
    expect(keys).toEqual(['a', 'tab-group:g', 'd', 'tab-group:h']);
    const proposed = proposeWorkspaceStripDragOrder(dragItems, order, groups, 'tab-group:g', 3);
    expect(proposed).toEqual(['a', 'd', 'e', 'b', 'c']);
    expect(getReleasedWorkspaceTabGroupMove(order, proposed, groups, 'g')).toEqual(['e', 'after']);
  });

  it('keeps the order when the group is dropped where it started', () => {
    const proposed = proposeWorkspaceStripDragOrder(dragItems, order, groups, 'tab-group:g', 1);
    expect(proposed).toEqual(order);
    expect(getReleasedWorkspaceTabGroupMove(order, proposed, groups, 'g')).toBeNull();
  });

  it('does not split the open group', () => {
    const open = layoutWorkspaceTabStrip(['b', 'c', 'e', 'a'], groups, 'g', null);
    expect(open.dragItems.map((item) => item.key)).toEqual(['b', 'c', 'tab-group:h', 'a']);
    expect(
      proposeWorkspaceStripDragOrder(
        open.dragItems,
        ['b', 'c', 'e', 'a'],
        groups,
        'tab-group:h',
        1,
      ),
    ).toEqual(['e', 'b', 'c', 'a']);
  });
});

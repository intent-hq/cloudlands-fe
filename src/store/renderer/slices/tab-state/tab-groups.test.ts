import { describe, expect, it } from 'vitest';
import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import {
  layoutWorkspaceTabsByProject,
  moveWorkspaceTabGroupInStacks,
  nextWorkspaceTabGroupColor,
  normalizeWorkspaceTabGroups,
  parsePersistedWorkspaceTabGroups,
  resolveMovedWorkspaceTabGroups,
  type WorkspaceTabGroup,
} from './tab-groups';
import {
  addWorkspaceTabToGroup,
  closeWorkspaceTab,
  createWorkspaceTabGroup,
  getWorkspaceTabGroupList,
  groupWorkspaceTabsByProject,
  loadWorkspaceTabsState,
  moveWorkspace,
  moveWorkspaceTabGroup,
  openWorkspaceTab,
  removeWorkspaceTabFromGroup,
  reopenLastClosedWorkspaceTab,
  serializeWorkspaceTabsState,
  setOpenWorkspaceTabGroup,
  switchToNextWorkspaceTab,
  switchToPreviousWorkspaceTab,
  switchToWorkspaceTabByIndex,
  tabStateReducer,
  type TabState,
} from './tab-state-slice';
import { selectOpenWorkspaceTabGroupId, selectWorkspaceTabGroups } from './tab-state-selectors';

const group = (id: string, workspaceIds: string[]): WorkspaceTabGroup => ({
  id,
  name: '',
  color: 'blue',
  workspaceIds,
});

function stateWithTabs(order: string[], tabGroups: WorkspaceTabGroup[] = []): TabState {
  return tabStateReducer(
    undefined,
    loadWorkspaceTabsState({
      openTabs: order,
      currentTabId: order[0] ?? null,
      pinnedTabs: [],
      unsavedTabs: [],
      optimisticTabs: [],
      tabOrder: order,
      tabGroups,
    }),
  );
}

const order = (state: TabState) => state.workspaceStacks.flat();
const members = (state: TabState, groupId: string) =>
  getWorkspaceTabGroupList(state).find((candidate) => candidate.id === groupId)?.workspaceIds;

describe('resolveMovedWorkspaceTabGroups', () => {
  it('adds a tab dropped between two members of a group', () => {
    const groups = resolveMovedWorkspaceTabGroups(
      ['a', 'x', 'b', 'c'],
      [group('g', ['a', 'b'])],
      'x',
    );
    expect(groups[0].workspaceIds).toEqual(['a', 'x', 'b']);
  });

  it('takes a member out when it is dropped away from the rest of its group', () => {
    const groups = resolveMovedWorkspaceTabGroups(
      ['a', 'b', 'c', 'x'],
      [group('g', ['a', 'b', 'x'])],
      'x',
    );
    expect(groups[0].workspaceIds).toEqual(['a', 'b']);
  });

  it('keeps a member that stays next to its group', () => {
    const groups = resolveMovedWorkspaceTabGroups(['b', 'a', 'c'], [group('g', ['a', 'b'])], 'b');
    expect(groups[0].workspaceIds).toEqual(['b', 'a']);
  });
});

describe('group data hygiene', () => {
  it('drops closed tabs and empty groups', () => {
    expect(normalizeWorkspaceTabGroups(['a'], [group('g', ['a', 'z']), group('h', ['z'])])).toEqual(
      [group('g', ['a'])],
    );
  });

  it('ignores malformed persisted groups', () => {
    expect(
      parsePersistedWorkspaceTabGroups([
        { id: 'g', color: 'blue', workspaceIds: ['a'] },
        { id: 'bad', color: 'chartreuse', workspaceIds: ['a'] },
        'nope',
      ]),
    ).toEqual([{ id: 'g', name: '', color: 'blue', workspaceIds: ['a'] }]);
  });

  it('picks an unused color first', () => {
    expect(nextWorkspaceTabGroupColor([group('g', ['a'])])).toBe('green');
  });
});

describe('selectWorkspaceTabGroups', () => {
  const stored = [group('g', ['a'])];
  const stateWith = (labsTabGroupsEnabled: boolean) =>
    ({
      tabState: { tabGroups: createCollection('id', stored) },
      userPreferences: { labsTabGroupsEnabled },
    }) as never;

  it('shows stored groups only while the tab groups Lab is on', () => {
    expect(selectWorkspaceTabGroups.select(stateWith(true))).toEqual(stored);
    expect(selectWorkspaceTabGroups.select(stateWith(false))).toEqual([]);
  });
});

describe('open group', () => {
  const openGroup = (state: TabState) =>
    selectOpenWorkspaceTabGroupId.select({
      tabState: state,
      userPreferences: { labsTabGroupsEnabled: true },
    } as never);

  it('stays open when an ungrouped tab is selected', () => {
    let state = stateWithTabs(['a', 'b', 'c'], [group('g', ['b', 'c'])]);
    state = tabStateReducer(state, openWorkspaceTab('b'));
    state = tabStateReducer(state, openWorkspaceTab('a'));
    expect(openGroup(state)).toBe('g');
  });

  it('closes only when toggled closed', () => {
    let state = stateWithTabs(['a', 'b'], [group('g', ['b'])]);
    state = tabStateReducer(state, setOpenWorkspaceTabGroup('g'));
    state = tabStateReducer(state, setOpenWorkspaceTabGroup(null));
    expect(openGroup(state)).toBeNull();
  });

  it('always shows the group holding the current tab', () => {
    const state = stateWithTabs(['b', 'a'], [group('g', ['b'])]);
    expect(state.currentTabId).toBe('b');
    expect(openGroup(tabStateReducer(state, setOpenWorkspaceTabGroup(null)))).toBe('g');
  });

  it.each([
    ['next', 'a', 'b', 'c', switchToNextWorkspaceTab()],
    ['previous', 'd', 'c', 'b', switchToPreviousWorkspaceTab()],
    ['index', 'a', 'c', 'b', switchToWorkspaceTabByIndex(2)],
  ] as const)(
    'records the group and selected member for the %s shortcut before route synchronization',
    (_name, from, selected, remembered, action) => {
      let state = stateWithTabs(
        ['a', 'b', 'c', 'd'],
        [{ ...group('g', ['b', 'c']), lastActiveWorkspaceId: remembered }],
      );
      state = tabStateReducer(state, openWorkspaceTab(from));
      const previous = state;
      state = tabStateReducer(state, action);

      expect(state).toMatchObject({
        currentTabId: selected,
        openTabGroupId: 'g',
        version: previous.version + 1,
      });
      expect(state.workspaceStacks).toBe(previous.workspaceStacks);
      expect(getWorkspaceTabGroupList(state)[0].lastActiveWorkspaceId).toBe(selected);
      expect(openGroup(state)).toBe('g');
      expect(tabStateReducer(state, openWorkspaceTab(selected))).toBe(state);

      state = tabStateReducer(state, openWorkspaceTab('a'));
      expect(openGroup(state)).toBe('g');
      expect(serializeWorkspaceTabsState(state)).toMatchObject({
        openTabGroupId: 'g',
        tabGroups: [{ id: 'g', lastActiveWorkspaceId: selected }],
      });
    },
  );

  it('keeps the keyboard-selected group open instead of restoring the previously open group', () => {
    let state = stateWithTabs(['a', 'b', 'c'], [group('h', ['a']), group('g', ['b'])]);
    state = tabStateReducer(state, setOpenWorkspaceTabGroup('h'));
    state = tabStateReducer(state, switchToNextWorkspaceTab());
    state = tabStateReducer(state, openWorkspaceTab('c'));
    expect(state.openTabGroupId).toBe('g');
    expect(openGroup(state)).toBe('g');
  });

  it.each([
    ['next neighbor', 'a', 'b', 'c'],
    ['previous neighbor', 'd', 'c', 'b'],
  ])('records group selection when closing to the %s', (_name, closed, selected, remembered) => {
    let state = stateWithTabs(
      ['a', 'b', 'c', 'd'],
      [{ ...group('g', ['b', 'c']), lastActiveWorkspaceId: remembered }],
    );
    state = tabStateReducer(state, openWorkspaceTab(closed));
    const previousVersion = state.version;
    state = tabStateReducer(state, closeWorkspaceTab(closed, 1));

    expect(state).toMatchObject({
      currentTabId: selected,
      openTabGroupId: 'g',
      version: previousVersion + 1,
    });
    expect(getWorkspaceTabGroupList(state)[0].lastActiveWorkspaceId).toBe(selected);
    expect(openGroup(state)).toBe('g');
    state = tabStateReducer(state, openWorkspaceTab(closed === 'a' ? 'd' : 'a'));
    expect(openGroup(state)).toBe('g');
  });

  it('remembers the surviving selected member after closing a member of the same group', () => {
    let state = stateWithTabs(['a', 'b', 'c'], [group('g', ['b', 'c'])]);
    state = tabStateReducer(state, openWorkspaceTab('b'));
    state = tabStateReducer(state, closeWorkspaceTab('b', 1));
    expect(state.currentTabId).toBe('c');
    expect(getWorkspaceTabGroupList(state)).toEqual([
      { ...group('g', ['c']), lastActiveWorkspaceId: 'c' },
    ]);
  });

  it('opens the fallback group after closing the last member of the current group', () => {
    let state = stateWithTabs(['a', 'b', 'c', 'd'], [group('h', ['b']), group('g', ['c'])]);
    state = tabStateReducer(state, openWorkspaceTab('b'));
    state = tabStateReducer(state, closeWorkspaceTab('b', 1));
    expect(getWorkspaceTabGroupList(state)).toEqual([
      { ...group('g', ['c']), lastActiveWorkspaceId: 'c' },
    ]);
    expect(state.openTabGroupId).toBe('g');
    state = tabStateReducer(state, openWorkspaceTab('d'));
    expect(openGroup(state)).toBe('g');
  });

  it('keeps an explicit chip collapse through route synchronization and selection outside the group', () => {
    let state = stateWithTabs(['a', 'b', 'c'], [group('g', ['b', 'c'])]);
    state = tabStateReducer(state, switchToWorkspaceTabByIndex(2));
    state = tabStateReducer(state, setOpenWorkspaceTabGroup(null));
    expect(tabStateReducer(state, openWorkspaceTab('c'))).toBe(state);
    state = tabStateReducer(state, openWorkspaceTab('a'));
    expect(state.openTabGroupId).toBeNull();
    expect(openGroup(state)).toBeNull();
    expect(getWorkspaceTabGroupList(state)[0].lastActiveWorkspaceId).toBe('c');
    expect(tabStateReducer(state, setOpenWorkspaceTabGroup(null))).toBe(state);
  });

  it('does not undo a chip collapse when closing a background tab', () => {
    let state = stateWithTabs(['a', 'b', 'c'], [group('g', ['b', 'c'])]);
    state = tabStateReducer(state, openWorkspaceTab('b'));
    state = tabStateReducer(state, setOpenWorkspaceTabGroup(null));
    state = tabStateReducer(state, closeWorkspaceTab('a', 1));
    expect(state.currentTabId).toBe('b');
    expect(state.openTabGroupId).toBeNull();
    expect(getWorkspaceTabGroupList(state)[0].lastActiveWorkspaceId).toBe('b');
  });

  it.each([
    ['next', switchToNextWorkspaceTab()],
    ['previous', switchToPreviousWorkspaceTab()],
    ['same index', switchToWorkspaceTabByIndex(0)],
    ['negative index', switchToWorkspaceTabByIndex(-1)],
    ['missing index', switchToWorkspaceTabByIndex(1)],
  ] as const)('keeps a %s shortcut with no selection change a no-op', (_name, action) => {
    let state = stateWithTabs(['b'], [group('g', ['b'])]);
    state = tabStateReducer(state, setOpenWorkspaceTabGroup(null));
    expect(tabStateReducer(state, action)).toBe(state);
  });

  it.each(['a', 'c'])(
    'records restored group selection when the prior current tab is %s',
    (current) => {
      let state = stateWithTabs(['a', 'b', 'c', 'd'], [group('old', ['c'])]);
      state = tabStateReducer(state, openWorkspaceTab(current));
      const previousVersion = state.version;
      state = tabStateReducer(
        state,
        loadWorkspaceTabsState({
          ...serializeWorkspaceTabsState(state),
          currentTabId: 'c',
          tabGroups: [
            { ...group('g', ['b', 'c', 'closed']), lastActiveWorkspaceId: 'b' },
            group('h', ['d']),
          ],
          openTabGroupId: 'h',
        }),
      );
      expect(state.version).toBe(previousVersion);
      expect(state.openTabGroupId).toBe('g');
      expect(getWorkspaceTabGroupList(state)[0]).toEqual({
        ...group('g', ['b', 'c']),
        lastActiveWorkspaceId: 'c',
      });
      state = tabStateReducer(state, openWorkspaceTab('a'));
      expect(openGroup(state)).toBe('g');
    },
  );

  it.each([null, 'g'])(
    'preserves restored expansion %s when the selected tab is ungrouped',
    (openTabGroupId) => {
      let state = stateWithTabs(['a', 'b'], [group('g', ['b'])]);
      state = tabStateReducer(
        state,
        loadWorkspaceTabsState({ ...serializeWorkspaceTabsState(state), openTabGroupId }),
      );
      expect(state.openTabGroupId).toBe(openTabGroupId);
      expect(openGroup(state)).toBe(openTabGroupId);
    },
  );

  it('keeps the group and its selected member when reopening an ungrouped tab', () => {
    let state = stateWithTabs(['a', 'b', 'c'], [group('g', ['b', 'c'])]);
    state = tabStateReducer(state, openWorkspaceTab('c'));
    state = tabStateReducer(state, closeWorkspaceTab('a', 1));
    state = tabStateReducer(state, reopenLastClosedWorkspaceTab());
    expect(state.currentTabId).toBe('a');
    expect(state.openTabGroupId).toBe('g');
    expect(openGroup(state)).toBe('g');
    expect(getWorkspaceTabGroupList(state)[0].lastActiveWorkspaceId).toBe('c');
  });
});

describe('tab group reducer', () => {
  it('moves a tab added to a group to the end of that group', () => {
    const state = tabStateReducer(
      stateWithTabs(['a', 'b', 'c', 'd'], [group('g', ['a', 'b'])]),
      addWorkspaceTabToGroup('d', 'g'),
    );
    expect(order(state)).toEqual(['a', 'b', 'd', 'c']);
    expect(members(state, 'g')).toEqual(['a', 'b', 'd']);
  });

  it('places a removed tab just after its old group', () => {
    const state = tabStateReducer(
      stateWithTabs(['a', 'b', 'c', 'd'], [group('g', ['a', 'b', 'c'])]),
      removeWorkspaceTabFromGroup('a'),
    );
    expect(order(state)).toEqual(['b', 'c', 'a', 'd']);
    expect(members(state, 'g')).toEqual(['b', 'c']);
  });

  it('moves a tab out of its old group when it starts a new group', () => {
    const state = tabStateReducer(
      stateWithTabs(['a', 'b', 'c'], [group('g', ['a', 'b'])]),
      createWorkspaceTabGroup('a', 'h', 'pink'),
    );
    expect(order(state)).toEqual(['b', 'a', 'c']);
    expect(members(state, 'g')).toEqual(['b']);
    expect(members(state, 'h')).toEqual(['a']);
  });

  it('applies the join rule when a tab is dragged into a group', () => {
    const state = tabStateReducer(
      stateWithTabs(['a', 'b', 'c'], [group('g', ['a', 'b'])]),
      moveWorkspace('c', 'b', 'before'),
    );
    expect(members(state, 'g')).toEqual(['a', 'c', 'b']);
  });

  it('removes the group when its last tab closes', () => {
    const state = tabStateReducer(
      stateWithTabs(['a', 'b'], [group('g', ['a'])]),
      closeWorkspaceTab('a', 1),
    );
    expect(getWorkspaceTabGroupList(state)).toEqual([]);
  });

  it('remembers the selected member and persists groups with the tabs', () => {
    const state = tabStateReducer(
      stateWithTabs(['a', 'b', 'c'], [group('g', ['b', 'c'])]),
      openWorkspaceTab('c'),
    );
    expect(serializeWorkspaceTabsState(state)).toMatchObject({
      tabGroups: [{ ...group('g', ['b', 'c']), lastActiveWorkspaceId: 'c' }],
      openTabGroupId: 'g',
    });
  });
});

describe('layoutWorkspaceTabsByProject', () => {
  const projects = {
    a1: { key: 'acme/app', name: 'app' },
    a2: { key: 'acme/app', name: 'app' },
    b1: { key: 'acme/api', name: 'api' },
    b2: { key: 'acme/api', name: 'api' },
    c1: { key: 'acme/docs', name: 'docs' },
  };

  it('sorts tabs by first appearance and groups projects with two or more tabs', () => {
    const layout = layoutWorkspaceTabsByProject(
      [['b1'], ['x'], ['a1'], ['c1'], ['b2'], ['a2']],
      [],
      projects,
    );
    expect(layout.workspaceStacks.flat()).toEqual(['b1', 'b2', 'x', 'a1', 'a2', 'c1']);
    expect(
      layout.groups.map(({ name, color, workspaceIds }) => [name, color, workspaceIds]),
    ).toEqual([
      ['api', 'blue', ['b1', 'b2']],
      ['app', 'green', ['a1', 'a2']],
    ]);
  });

  it('keeps the name and color of an earlier project group', () => {
    const earlier: WorkspaceTabGroup = {
      id: 'project:acme/app',
      name: 'Frontend',
      color: 'blue',
      workspaceIds: ['a1'],
      lastActiveWorkspaceId: 'a1',
    };
    const layout = layoutWorkspaceTabsByProject(
      [['b1'], ['a1'], ['b2'], ['a2']],
      [earlier],
      projects,
    );
    expect(layout.groups).toEqual([
      { id: 'project:acme/api', name: 'api', color: 'green', workspaceIds: ['b1', 'b2'] },
      { ...earlier, workspaceIds: ['a1', 'a2'] },
    ]);
  });

  it('keeps manual groups whole and groups only the other tabs by project', () => {
    const manual = { ...group('manual', ['a1', 'b1']), color: 'green' as const };
    const layout = layoutWorkspaceTabsByProject(
      [['b2'], ['a1'], ['b1'], ['a2'], ['x'], ['c1'], ['b3']],
      [manual],
      { ...projects, b3: { key: 'acme/api', name: 'api' } },
    );
    expect(layout.workspaceStacks.flat()).toEqual(['b2', 'b3', 'a1', 'b1', 'a2', 'x', 'c1']);
    expect(layout.groups.map(({ id, color, workspaceIds }) => [id, color, workspaceIds])).toEqual([
      ['project:acme/api', 'blue', ['b2', 'b3']],
      ['manual', 'green', ['a1', 'b1']],
    ]);
  });

  it('moves a stack with the project of its first tab', () => {
    const layout = layoutWorkspaceTabsByProject([['a1', 'b1'], ['b2'], ['a2']], [], projects);
    expect(layout.workspaceStacks).toEqual([['a1', 'b1'], ['a2'], ['b2']]);
    expect(layout.groups.map((candidate) => candidate.workspaceIds)).toEqual([['a1', 'b1', 'a2']]);
  });
});

describe('moveWorkspaceTabGroupInStacks', () => {
  const groups = [group('g', ['b', 'c']), group('h', ['e', 'f'])];
  const stacks = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => [id]);

  it('moves every member as one block', () => {
    expect(moveWorkspaceTabGroupInStacks(stacks, groups, 'g', 'f', 'after')?.flat()).toEqual([
      'a',
      'd',
      'e',
      'f',
      'b',
      'c',
    ]);
  });

  it('snaps a target inside another group to that group edge', () => {
    expect(moveWorkspaceTabGroupInStacks(stacks, groups, 'g', 'f', 'before')?.flat()).toEqual([
      'a',
      'd',
      'b',
      'c',
      'e',
      'f',
    ]);
  });

  it('returns null when the group does not move', () => {
    expect(moveWorkspaceTabGroupInStacks(stacks, groups, 'g', 'd', 'before')).toBeNull();
    expect(moveWorkspaceTabGroupInStacks(stacks, groups, 'g', 'c', 'after')).toBeNull();
  });
});

describe('group reducers', () => {
  it('moves a group and keeps its members', () => {
    const state = tabStateReducer(
      stateWithTabs(['a', 'b', 'c', 'd'], [group('g', ['a', 'b'])]),
      moveWorkspaceTabGroup('g', 'd', 'after'),
    );
    expect(order(state)).toEqual(['c', 'd', 'a', 'b']);
    expect(members(state, 'g')).toEqual(['a', 'b']);
  });

  it('groups by project and opens the group of the current tab', () => {
    const state = tabStateReducer(
      stateWithTabs(['a1', 'b1', 'a2', 'b2']),
      groupWorkspaceTabsByProject({
        a1: { key: 'app', name: 'app' },
        a2: { key: 'app', name: 'app' },
        b1: { key: 'api', name: 'api' },
        b2: { key: 'api', name: 'api' },
      }),
    );
    expect(order(state)).toEqual(['a1', 'a2', 'b1', 'b2']);
    expect(state.openTabGroupId).toBe('project:app');
    expect(getWorkspaceTabGroupList(state).map((candidate) => candidate.name)).toEqual([
      'app',
      'api',
    ]);
  });
});

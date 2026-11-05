import { describe, expect, it } from 'vitest';
import {
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
  loadWorkspaceTabsState,
  moveWorkspace,
  openWorkspaceTab,
  removeWorkspaceTabFromGroup,
  serializeWorkspaceTabsState,
  tabStateReducer,
  type TabState,
} from './tab-state-slice';

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
  state.tabGroups.find((candidate) => candidate.id === groupId)?.workspaceIds;

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
    expect(state.tabGroups).toEqual([]);
  });

  it('remembers the selected member and persists groups with the tabs', () => {
    const state = tabStateReducer(
      stateWithTabs(['a', 'b', 'c'], [group('g', ['b', 'c'])]),
      openWorkspaceTab('c'),
    );
    expect(serializeWorkspaceTabsState(state).tabGroups).toEqual([
      { ...group('g', ['b', 'c']), lastActiveWorkspaceId: 'c' },
    ]);
  });
});

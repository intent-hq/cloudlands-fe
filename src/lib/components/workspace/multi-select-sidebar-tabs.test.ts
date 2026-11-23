import { describe, expect, it } from 'vitest';
import { normalizeSelectedTabs, orderSelectedTabs } from './multi-select-sidebar-tabs';
import { selectMultiSelectSidebarSelectedTabIds } from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';
import type { StoreState } from '$store/renderer/types';

describe('multi-select sidebar tabs', () => {
  it('keeps valid selections and migrates the old overview to agents', () => {
    expect([...normalizeSelectedTabs(['unknown', 'changes', 'files'])]).toEqual([
      'changes',
      'files',
    ]);
    expect([...normalizeSelectedTabs(['browser', 'shell'])]).toEqual(['browser', 'shell']);
    expect([...normalizeSelectedTabs(['unknown'])]).toEqual(['agents']);
    expect([...normalizeSelectedTabs(['overview'])]).toEqual(['agents']);
    expect([...normalizeSelectedTabs([])]).toEqual(['agents']);
  });

  it('drops persisted browser and shell selections for collaborators (multiplayer w3)', () => {
    expect([...normalizeSelectedTabs(['browser', 'shell'], true)]).toEqual(['agents']);
    expect([...normalizeSelectedTabs(['shell', 'files'], true)]).toEqual(['files']);
    expect([...normalizeSelectedTabs(['browser', 'shell'], false)]).toEqual(['browser', 'shell']);
  });

  it('allows People for collaborators and drops it when sharing is unavailable', () => {
    expect([...normalizeSelectedTabs(['people'], true, true)]).toEqual(['people']);
    expect([...normalizeSelectedTabs(['people'], false, false)]).toEqual(['agents']);
    expect([...normalizeSelectedTabs(['people', 'context'], true, false)]).toEqual(['context']);
  });

  it('opens People above Agents by default only when the workspace has people', () => {
    const fresh = selectMultiSelectSidebarSelectedTabIds.select(
      { sidebarNav: { multiSelectSelectedTabIdsByWorkspaceId: {} } } as unknown as StoreState,
      'ws-1',
    );
    expect(orderSelectedTabs(normalizeSelectedTabs(fresh, false, true))).toEqual([
      'people',
      'agents',
    ]);
    expect(orderSelectedTabs(normalizeSelectedTabs(fresh, false, false))).toEqual(['agents']);
    expect(orderSelectedTabs(normalizeSelectedTabs(['agents'], false, true))).toEqual(['agents']);
  });
});

it('keeps a Manager saved-script Shell selection while still stripping Browser', () => {
  expect([...normalizeSelectedTabs(['shell'], true, true, true)]).toEqual(['shell']);
  expect([...normalizeSelectedTabs(['browser'], true, true, true)]).toEqual(['agents']);
  expect([...normalizeSelectedTabs(['shell'], true, true, false)]).toEqual(['agents']);
});

it('drops a persisted Changes selection for plain-folder workspaces only', () => {
  expect([...normalizeSelectedTabs(['changes', 'files'], false, true, false, true)]).toEqual([
    'files',
  ]);
  expect([...normalizeSelectedTabs(['changes'], false, true, false, true)]).toEqual(['agents']);
  expect([...normalizeSelectedTabs(['changes'], false, true, false, false)]).toEqual(['changes']);
});

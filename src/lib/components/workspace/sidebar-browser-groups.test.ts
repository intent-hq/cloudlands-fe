import { describe, expect, it } from 'vitest';

import type { AgentSession } from '$shared/types';
import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';
import { groupBrowserTabsByOwner, resolveOwnerName } from './sidebar-browser-groups';

function browserTab(id: string, ownerAgentId?: string, ownerAgentName?: string): PanelTab {
  return {
    id,
    type: 'browser',
    title: `Tab ${id}`,
    closable: true,
    browserUrl: `https://example.com/${id}`,
    ...(ownerAgentId === undefined ? {} : { ownerAgentId }),
    ...(ownerAgentName === undefined ? {} : { ownerAgentName }),
  };
}

function agent(id: string, name: string): AgentSession {
  return { id, name } as unknown as AgentSession;
}

describe('resolveOwnerName', () => {
  it('resolves the agent display name from sessions', () => {
    expect(resolveOwnerName('agent-1', [agent('agent-1', 'Docs Writer')])).toBe('Docs Writer');
  });

  it('falls back to a shortened id when the session is unknown', () => {
    expect(resolveOwnerName('agent-0123456789abcdef', [])).toBe('agent-01234567…');
  });

  it('falls back to the full id when it is short', () => {
    expect(resolveOwnerName('agent-1', [])).toBe('agent-1');
  });

  it('falls back when the session name is blank', () => {
    expect(resolveOwnerName('agent-1', [agent('agent-1', '  ')])).toBe('agent-1');
  });

  // monorepo#3438: the store often lacks idle/unloaded owners — the name
  // persisted with the tab must label the group instead of the raw id.
  it('falls back to the persisted tab name when the session is unknown', () => {
    expect(resolveOwnerName('agent-0123456789abcdef', [], 'Fix screenshot timeout')).toBe(
      'Fix screenshot timeout',
    );
  });

  it('prefers the live session name over the persisted tab name (renames)', () => {
    expect(resolveOwnerName('agent-1', [agent('agent-1', 'Renamed Agent')], 'Stale Name')).toBe(
      'Renamed Agent',
    );
  });

  it('shortens the id when the persisted name is blank and the session is unknown', () => {
    expect(resolveOwnerName('agent-0123456789abcdef', [], '  ')).toBe('agent-01234567…');
  });
});

describe('groupBrowserTabsByOwner', () => {
  it('groups visible tabs by owner with Unclaimed last', () => {
    const groups = groupBrowserTabsByOwner(
      [
        { tab: browserTab('t1'), panelId: 'p1', active: false },
        { tab: browserTab('t2', 'agent-a'), panelId: 'p1', active: true },
        { tab: browserTab('t3', 'agent-b'), panelId: 'p2', active: false },
        { tab: browserTab('t4', 'agent-a'), panelId: 'p2', active: false },
      ],
      [],
      [agent('agent-a', 'Agent A'), agent('agent-b', 'Agent B')],
    );

    expect(groups.map((g) => g.ownerAgentId)).toEqual(['agent-a', 'agent-b', null]);
    expect(groups[0].ownerName).toBe('Agent A');
    expect(groups[0].entries.map((e) => e.tab.id)).toEqual(['t2', 't4']);
    expect(groups[2].ownerName).toBeNull();
    expect(groups[2].entries.map((e) => e.tab.id)).toEqual(['t1']);
  });

  it('lists hidden owned tabs in their owner group after visible ones', () => {
    const groups = groupBrowserTabsByOwner(
      [{ tab: browserTab('t1', 'agent-a'), panelId: 'p1', active: true }],
      [browserTab('t2', 'agent-a')],
      [agent('agent-a', 'Agent A')],
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].entries.map((e) => ({ id: e.tab.id, hidden: e.hidden }))).toEqual([
      { id: 't1', hidden: false },
      { id: 't2', hidden: true },
    ]);
    expect(groups[0].entries[1].active).toBe(false);
    expect(groups[0].entries[1].panelId).toBeUndefined();
  });

  it('creates a group for a hidden tab whose owner has no visible tabs', () => {
    const groups = groupBrowserTabsByOwner([], [browserTab('t1', 'agent-a')], []);

    expect(groups).toHaveLength(1);
    expect(groups[0].ownerAgentId).toBe('agent-a');
    expect(groups[0].entries[0].hidden).toBe(true);
  });

  it('ignores non-browser hidden tabs and omits an empty Unclaimed group', () => {
    const notBrowser = { ...browserTab('t9'), type: 'note' } as PanelTab;
    const groups = groupBrowserTabsByOwner(
      [{ tab: browserTab('t1', 'agent-a'), panelId: 'p1', active: false }],
      [notBrowser],
      [],
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].ownerAgentId).toBe('agent-a');
  });

  it('returns no groups for no tabs', () => {
    expect(groupBrowserTabsByOwner([], [], [])).toEqual([]);
  });

  // monorepo#3438: group headers showed the raw shortened owner id when the
  // agent store had not loaded the (idle) owner.
  it('labels a group with the persisted tab name when the owner is not in the store', () => {
    const groups = groupBrowserTabsByOwner(
      [
        {
          tab: browserTab('t1', 'agent-0123456789abcdef', 'Fix screenshot timeout'),
          panelId: 'p1',
          active: false,
        },
      ],
      [],
      [],
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].ownerName).toBe('Fix screenshot timeout');
  });

  it('labels a group with the live store name over the persisted tab name', () => {
    const groups = groupBrowserTabsByOwner(
      [{ tab: browserTab('t1', 'agent-a', 'Stale Name'), panelId: 'p1', active: false }],
      [],
      [agent('agent-a', 'Renamed Agent')],
    );

    expect(groups[0].ownerName).toBe('Renamed Agent');
  });

  it('labels a hidden-only group with the persisted tab name', () => {
    const groups = groupBrowserTabsByOwner(
      [],
      [browserTab('t1', 'agent-0123456789abcdef', 'Fix screenshot timeout')],
      [],
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].ownerName).toBe('Fix screenshot timeout');
  });

  it('falls back to the shortened id when neither store nor tab carries a name', () => {
    const groups = groupBrowserTabsByOwner(
      [{ tab: browserTab('t1', 'agent-0123456789abcdef'), panelId: 'p1', active: false }],
      [],
      [],
    );

    expect(groups[0].ownerName).toBe('agent-01234567…');
  });

  // Ordering must not matter: a group created from a name-less tab is
  // upgraded when a later tab for the same owner carries a persisted name.
  it('upgrades the group label when a later visible tab carries the persisted name', () => {
    const groups = groupBrowserTabsByOwner(
      [
        { tab: browserTab('t1', 'agent-0123456789abcdef'), panelId: 'p1', active: false },
        {
          tab: browserTab('t2', 'agent-0123456789abcdef', 'Fix screenshot timeout'),
          panelId: 'p1',
          active: false,
        },
      ],
      [],
      [],
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].ownerName).toBe('Fix screenshot timeout');
    expect(groups[0].entries).toHaveLength(2);
  });

  it('upgrades the group label when a hidden tab carries the persisted name', () => {
    const groups = groupBrowserTabsByOwner(
      [{ tab: browserTab('t1', 'agent-0123456789abcdef'), panelId: 'p1', active: false }],
      [browserTab('t2', 'agent-0123456789abcdef', 'Fix screenshot timeout')],
      [],
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].ownerName).toBe('Fix screenshot timeout');
  });

  it('keeps the first persisted name when later tabs carry a different one', () => {
    const groups = groupBrowserTabsByOwner(
      [
        {
          tab: browserTab('t1', 'agent-0123456789abcdef', 'First Name'),
          panelId: 'p1',
          active: false,
        },
        {
          tab: browserTab('t2', 'agent-0123456789abcdef', 'Second Name'),
          panelId: 'p1',
          active: false,
        },
      ],
      [],
      [],
    );

    expect(groups[0].ownerName).toBe('First Name');
  });
});

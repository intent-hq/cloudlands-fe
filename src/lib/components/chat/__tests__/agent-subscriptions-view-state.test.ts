import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'agent-subscriptions:view-state:v1';

type ViewStateModule = typeof import('../agent-subscriptions-view-state');

async function reloadModule(): Promise<ViewStateModule> {
  vi.resetModules();
  return import('../agent-subscriptions-view-state');
}

describe('agent subscriptions view state persistence', () => {
  let now = 1_000;

  beforeEach(() => {
    now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now++);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps every disclosure choice for an agent thread across a reload', async () => {
    const before = await reloadModule();
    before.setEventSubscriptionsExpanded('ws-1', 'agent-1', false);
    before.setWaitingAgentsExpanded('ws-1', 'agent-1', true);
    before.setFinishedAgentsExpanded('ws-1', 'agent-1', true);
    before.setExpandedPrMonitorId('ws-1', 'agent-1', 'monitor-7');

    const after = await reloadModule();
    expect(after.getEventSubscriptionsExpanded('ws-1', 'agent-1')).toBe(false);
    expect(after.getWaitingAgentsExpanded('ws-1', 'agent-1')).toBe(true);
    expect(after.getFinishedAgentsExpanded('ws-1', 'agent-1')).toBe(true);
    expect(after.getExpandedPrMonitorId('ws-1', 'agent-1')).toBe('monitor-7');
  });

  it('scopes choices to the workspace and agent', async () => {
    const before = await reloadModule();
    before.setEventSubscriptionsExpanded('ws-1', 'agent-1', false);

    const after = await reloadModule();
    expect(after.getEventSubscriptionsExpanded('ws-1', 'agent-2')).toBe(true);
    expect(after.getEventSubscriptionsExpanded('ws-2', 'agent-1')).toBe(true);
  });

  it('falls back to defaults when stored data is corrupt or has the wrong shape', async () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    let state = await reloadModule();
    expect(state.getEventSubscriptionsExpanded('ws-1', 'agent-1')).toBe(true);

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        'ws-1:agent-1': { events: 'no', waiting: 1, finished: null, prMonitorId: 42, at: 'x' },
        'ws-1:agent-2': 'garbage',
      }),
    );
    state = await reloadModule();
    expect(state.getEventSubscriptionsExpanded('ws-1', 'agent-1')).toBe(true);
    expect(state.getWaitingAgentsExpanded('ws-1', 'agent-1')).toBe(false);
    expect(state.getFinishedAgentsExpanded('ws-1', 'agent-1')).toBe(false);
    expect(state.getExpandedPrMonitorId('ws-1', 'agent-1')).toBeNull();
    expect(state.getEventSubscriptionsExpanded('ws-1', 'agent-2')).toBe(true);

    state.setEventSubscriptionsExpanded('ws-1', 'agent-1', false);
    expect((await reloadModule()).getEventSubscriptionsExpanded('ws-1', 'agent-1')).toBe(false);
  });

  it('keeps working in memory when storage writes fail', async () => {
    const state = await reloadModule();
    state.setEventSubscriptionsExpanded('ws-1', 'agent-1', true);
    vi.mocked(localStorage.setItem).mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });

    state.setEventSubscriptionsExpanded('ws-1', 'agent-1', false);
    expect(vi.mocked(localStorage.setItem).mock.results.at(-1)?.type).toBe('throw');
    expect(state.getEventSubscriptionsExpanded('ws-1', 'agent-1')).toBe(false);
  });

  it('merges choices another window saved for the same thread', async () => {
    const state = await reloadModule();
    state.setEventSubscriptionsExpanded('ws-1', 'agent-1', false);

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<
      string,
      Record<string, unknown>
    >;
    stored['ws-1:agent-1'] = { ...stored['ws-1:agent-1'], waiting: true, at: now++ };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

    expect(state.getWaitingAgentsExpanded('ws-1', 'agent-1')).toBe(true);
    state.setFinishedAgentsExpanded('ws-1', 'agent-1', true);

    const after = await reloadModule();
    expect(after.getEventSubscriptionsExpanded('ws-1', 'agent-1')).toBe(false);
    expect(after.getWaitingAgentsExpanded('ws-1', 'agent-1')).toBe(true);
    expect(after.getFinishedAgentsExpanded('ws-1', 'agent-1')).toBe(true);
  });

  it('never persists choices for memory-only preview workspaces', async () => {
    const state = await reloadModule();
    state.keepAgentSubscriptionsViewStateInMemory('preview-ws');
    state.setEventSubscriptionsExpanded('preview-ws', 'agent-1', false);

    expect(state.getEventSubscriptionsExpanded('preview-ws', 'agent-1')).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect((await reloadModule()).getEventSubscriptionsExpanded('preview-ws', 'agent-1')).toBe(
      true,
    );
  });

  it('drops the least recently changed threads once the cap is reached', async () => {
    const state = await reloadModule();
    const cap = state.AGENT_SUBSCRIPTIONS_VIEW_STATE_LIMIT;

    for (let index = 0; index <= cap; index += 1) {
      state.setEventSubscriptionsExpanded('ws-1', `agent-${index}`, false);
    }
    state.setWaitingAgentsExpanded('ws-1', 'agent-1', true);
    state.setEventSubscriptionsExpanded('ws-1', 'agent-new', false);

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>;
    expect(Object.keys(stored)).toHaveLength(cap);

    const after = await reloadModule();
    expect(after.getEventSubscriptionsExpanded('ws-1', 'agent-0')).toBe(true);
    expect(after.getEventSubscriptionsExpanded('ws-1', 'agent-2')).toBe(true);
    expect(after.getEventSubscriptionsExpanded('ws-1', 'agent-1')).toBe(false);
    expect(after.getWaitingAgentsExpanded('ws-1', 'agent-1')).toBe(true);
    expect(after.getEventSubscriptionsExpanded('ws-1', 'agent-new')).toBe(false);
  });

  it('clears persisted choices on the test reset hook', async () => {
    const state = await reloadModule();
    state.setEventSubscriptionsExpanded('ws-1', 'agent-1', false);
    state.resetAgentSubscriptionsViewStateForTests();

    expect((await reloadModule()).getEventSubscriptionsExpanded('ws-1', 'agent-1')).toBe(true);
  });
});

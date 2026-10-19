import { cleanup, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { writable } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ dispatch: vi.fn() }));
const agents$ = writable<Array<Record<string, unknown>>>([]);
const activeId$ = writable<string | null>(null);
const loaded$ = writable(true);

vi.mock('$lib/components/chat/ChatPanel.svelte', async () => ({
  default: (await import('$lib/components/chat/__tests__/mocks/SlotOnly.svelte')).default,
}));
vi.mock('$store/renderer/store', () => ({ store: { dispatch: mocks.dispatch } }));
vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-selectors', () => ({
  selectAllWorkspaceAgents: () => agents$,
  selectActiveAgentId: () => activeId$,
  selectAgentsLoaded: () => loaded$,
  resolveCanonicalInitialAgent: (agents: Array<{ id: string }>) => agents[0] ?? null,
}));

import HomeWorkspaceChat from './HomeWorkspaceChat.svelte';
import { MARK_AGENT_SEEN_DEBOUNCE_MS } from '$features/agent/mark-agent-seen';
import type { Workspace } from '$shared/types';

const workspace = { id: 'ws-1', title: 'Workspace' } as unknown as Workspace;
const agent = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, ...extra });

function viewEnds(): string[] {
  return mocks.dispatch.mock.calls
    .map(([action]) => action as { type: string; payload: [string] })
    .filter((action) => action.type === 'unreadTracking/chatViewEnded')
    .map((action) => action.payload[0]);
}

/** Let the deferred (post-teardown) dispatch run. */
const flushDeferred = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  mocks.dispatch.mockClear();
  agents$.set([agent('a1'), agent('a2')]);
  activeId$.set('a1');
  loaded$.set(true);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// Regression: leaving a conversation in Home never ended its viewing session,
// so the seen marker and the "New messages" divider stayed where they were.
describe('Home workspace chat viewing session', () => {
  it('ends the viewing session after the displayed agent changes', async () => {
    render(HomeWorkspaceChat, { workspace });
    await tick();
    await vi.advanceTimersByTimeAsync(MARK_AGENT_SEEN_DEBOUNCE_MS);
    expect(viewEnds()).toEqual([]);
    activeId$.set('a2');
    await tick();
    await flushDeferred();
    expect(viewEnds()).toEqual(['a1']);
  });

  it('ends the viewing session after the chat unmounts', async () => {
    const view = render(HomeWorkspaceChat, { workspace });
    await tick();
    await vi.advanceTimersByTimeAsync(MARK_AGENT_SEEN_DEBOUNCE_MS);
    view.unmount();
    await flushDeferred();
    expect(viewEnds()).toEqual(['a1']);
  });

  // A conversation flashed while the active agent resolves (or skimmed past
  // faster than the view trigger's debounce) was never read.
  it('does not end a viewing session shorter than the view debounce', async () => {
    render(HomeWorkspaceChat, { workspace });
    await tick();
    await vi.advanceTimersByTimeAsync(MARK_AGENT_SEEN_DEBOUNCE_MS - 1);
    activeId$.set('a2');
    await tick();
    await flushDeferred();
    expect(viewEnds()).toEqual([]);
  });

  it('keeps the viewing session across agent list refreshes', async () => {
    render(HomeWorkspaceChat, { workspace });
    await tick();
    await vi.advanceTimersByTimeAsync(MARK_AGENT_SEEN_DEBOUNCE_MS);
    agents$.set([agent('a1', { name: 'renamed' }), agent('a2'), agent('a3')]);
    await tick();
    await flushDeferred();
    expect(viewEnds()).toEqual([]);
  });

  it('does not report fixture previews', async () => {
    const view = render(HomeWorkspaceChat, { workspace, preview: true });
    await tick();
    await vi.advanceTimersByTimeAsync(MARK_AGENT_SEEN_DEBOUNCE_MS);
    view.unmount();
    await flushDeferred();
    expect(viewEnds()).toEqual([]);
  });
});

import { cleanup, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { writable } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ dispatch: vi.fn() }));
const agents$ = writable<Array<Record<string, unknown>>>([]);
const loaded$ = writable(true);

vi.mock('$lib/components/chat/ChatPanel.svelte', async () => ({
  default: (await import('$lib/components/chat/__tests__/mocks/SlotOnly.svelte')).default,
}));
vi.mock('$store/renderer/store', () => ({ store: { dispatch: mocks.dispatch } }));
vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-selectors', () => ({
  selectAllWorkspaceAgents: () => agents$,
  selectAgentsLoaded: () => loaded$,
}));

import HomeWorkspaceChat from './HomeWorkspaceChat.svelte';
import { setHomePreviewAgent } from './home-workspaces-slice';
import { setActiveAgentId } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import { MARK_AGENT_SEEN_DEBOUNCE_MS } from '$features/agent/mark-agent-seen';
import type { AgentSession, Workspace } from '$shared/types';

const workspace = { id: 'ws-1', title: 'Workspace' } as unknown as Workspace;
const agent = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, name: id, ...extra }) as unknown as AgentSession;

const renderChat = (props: { agent?: AgentSession | null; preview?: boolean } = {}) =>
  render(HomeWorkspaceChat, {
    workspace,
    agent: agent('a1'),
    ...props,
  });

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
  agents$.set([agent('a1'), agent('a2')] as unknown as Array<Record<string, unknown>>);
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
    const view = renderChat();
    await tick();
    await vi.advanceTimersByTimeAsync(MARK_AGENT_SEEN_DEBOUNCE_MS);
    expect(viewEnds()).toEqual([]);
    await view.rerender({ agent: agent('a2') });
    await tick();
    await flushDeferred();
    expect(viewEnds()).toEqual(['a1']);
  });

  it('ends the viewing session after the chat unmounts', async () => {
    const view = renderChat();
    await tick();
    await vi.advanceTimersByTimeAsync(MARK_AGENT_SEEN_DEBOUNCE_MS);
    view.unmount();
    await flushDeferred();
    expect(viewEnds()).toEqual(['a1']);
  });

  // A conversation flashed while the active agent resolves (or skimmed past
  // faster than the view trigger's debounce) was never read.
  it('does not end a viewing session shorter than the view debounce', async () => {
    const view = renderChat();
    await tick();
    await vi.advanceTimersByTimeAsync(MARK_AGENT_SEEN_DEBOUNCE_MS - 1);
    await view.rerender({ agent: agent('a2') });
    await tick();
    await flushDeferred();
    expect(viewEnds()).toEqual([]);
  });

  it('keeps the viewing session across agent list refreshes', async () => {
    const view = renderChat();
    await tick();
    await vi.advanceTimersByTimeAsync(MARK_AGENT_SEEN_DEBOUNCE_MS);
    await view.rerender({ agent: agent('a1', { name: 'renamed' }) });
    await tick();
    await flushDeferred();
    expect(viewEnds()).toEqual([]);
  });

  it('does not report fixture previews', async () => {
    const view = renderChat({ preview: true });
    await tick();
    await vi.advanceTimersByTimeAsync(MARK_AGENT_SEEN_DEBOUNCE_MS);
    view.unmount();
    await flushDeferred();
    expect(viewEnds()).toEqual([]);
  });
});

describe('Home workspace chat attention focus', () => {
  it("records the attention item's agent as the explicit pick", async () => {
    const view = renderChat();
    await tick();
    (view.component as unknown as { focusAttention: (id: string) => void }).focusAttention('a2');
    expect(mocks.dispatch).toHaveBeenCalledWith(setHomePreviewAgent('ws-1', 'a2'));
    expect(mocks.dispatch).toHaveBeenCalledWith(setActiveAgentId('ws-1', 'a2'));
  });

  it('ignores an attention item for an agent the preview cannot show', async () => {
    agents$.set([
      agent('a1'),
      agent('gone', { retiredAt: '2026-03-19T00:00:00.000Z' }),
    ] as unknown as Array<Record<string, unknown>>);
    const view = renderChat();
    await tick();
    (view.component as unknown as { focusAttention: (id: string) => void }).focusAttention('gone');
    expect(mocks.dispatch).not.toHaveBeenCalledWith(setHomePreviewAgent('ws-1', 'gone'));
  });
});

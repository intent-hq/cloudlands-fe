import { runSaga, stdChannel } from 'redux-saga';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';

const marks = vi.hoisted(() => ({ boundary: vi.fn(), finish: vi.fn(), send: vi.fn() }));
vi.mock('$features/agent/mark-agent-seen', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$features/agent/mark-agent-seen')>();
  return {
    ...actual,
    markAgentSeenAtBoundary: marks.boundary,
    markAgentSeenOnTurnFinish: marks.finish,
    markAgentSeenOnUserSend: marks.send,
  };
});

import {
  clearChatScrollCacheForTests,
  getCachedChatScroll,
  setCachedChatScroll,
} from '$lib/components/chat/chat-scroll-cache';
import { sendMessage } from '../../chat-state/chat-state-slice';
import { closeTab } from '../../panel-layout/panel-layout-slice';
import { closePanel } from '../../sidebar-nav/sidebar-nav-slice';
import { openWorkspaceTab } from '../../tab-state/tab-state-slice';
import { agentStreamUpdateReceived } from '../../workspace-agents/workspace-agents-stream-slice';
import type { StoreState } from '../../../types';
import type { DividerBoundarySnapshot } from '../unread-tracking-selectors';
import { detectDividerSessionBoundary, unreadTrackingSaga } from './unread-tracking-saga';

const snapshot = (overrides: Partial<DividerBoundarySnapshot> = {}): DividerBoundarySnapshot => ({
  activeWorkspaceId: 'ws-1',
  chiefCardVisible: false,
  chiefSessionAgentIds: [],
  dividerSessionAgentIds: [],
  openAgentTabIds: [],
  ...overrides,
});

function state(
  current: DividerBoundarySnapshot,
  agentSessionsByAgentId: Record<string, { messages: unknown[]; isStreaming?: boolean }> = {},
): StoreState {
  return {
    tabState: { currentTabId: current.activeWorkspaceId },
    sidebarNav: {
      panelItem: current.chiefCardVisible ? 'chief' : null,
      expandedItem: null,
      hoveredItem: null,
    },
    unreadTracking: {
      currentlyViewedAgentId: null,
      dividerSessionByAgentId: Object.fromEntries(
        current.dividerSessionAgentIds.map((id) => [id, { anchorId: null }]),
      ),
      watchedStreamingTailByAgentId: {},
    },
    agentSessions: {
      byAgentId: agentSessionsByAgentId,
      agentIdsByWorkspace: { [CHIEF_WORKSPACE_ID]: current.chiefSessionAgentIds },
    },
    panelLayout: {
      byWorkspaceId: {
        'ws-1': {
          panels: {
            main: {
              id: 'main',
              activeTabId: null,
              tabs: current.openAgentTabIds.map((agentId) => ({
                id: `tab-${agentId}`,
                type: 'agent',
                agentId,
                title: agentId,
                closable: true,
              })),
            },
          },
        },
      },
    },
  } as unknown as StoreState;
}

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

// The boundary cache-clear is deferred one macrotask (past Svelte's
// microtask teardown flush), so tests asserting it must settle timers too.
const settlePastTeardown = async () => {
  await new Promise((resolve) => setTimeout(resolve, 1));
  await settle();
};

function startSaga(
  channel: ReturnType<typeof stdChannel>,
  dispatch: ReturnType<typeof vi.fn>,
  getState: () => StoreState,
) {
  const listeners = new Set<() => void>();
  const reduxStore = {
    getState,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const task = runSaga(
    { channel, dispatch, getState, context: { reduxStore } },
    unreadTrackingSaga,
  );
  return { task, notify: () => listeners.forEach((listener) => listener()) };
}

describe('detectDividerSessionBoundary', () => {
  it('detects only sessions whose previously open tab closed', () => {
    const previous = snapshot({
      dividerSessionAgentIds: ['a1', 'chief-1'],
      openAgentTabIds: ['a1'],
    });
    const current = snapshot({ dividerSessionAgentIds: ['a1', 'chief-1'] });
    expect(detectDividerSessionBoundary(previous, current, closeTab.type)).toEqual({
      kind: 'tab-close',
      agentIds: ['a1'],
    });
  });

  it('exempts chief sessions from workspace switches', () => {
    const previous = snapshot({ dividerSessionAgentIds: ['a1', 'chief-1'] });
    const current = snapshot({
      activeWorkspaceId: 'ws-2',
      dividerSessionAgentIds: ['a1', 'chief-1'],
      chiefSessionAgentIds: ['chief-1'],
    });
    expect(detectDividerSessionBoundary(previous, current, openWorkspaceTab.type)).toEqual({
      kind: 'workspace-switch',
      agentIds: ['a1'],
      previousWorkspaceId: 'ws-1',
      nextWorkspaceId: 'ws-2',
    });
  });

});

describe('unreadTrackingSaga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearChatScrollCacheForTests();
  });

  it('owns user-send and terminal-stream mark-seen triggers', async () => {
    const channel = stdChannel();
    const current = snapshot();
    const { task } = startSaga(channel, vi.fn(), () => state(current));
    channel.put(sendMessage('a1', { wsId: 'ws-1', text: 'hello' }));
    channel.put(
      agentStreamUpdateReceived({
        agentId: 'a1',
        handlerSessionId: 'handler-1',
        source: 'sendMessage',
        eventType: 'complete',
      }),
    );
    await settle();
    expect(marks.send).toHaveBeenCalledWith('a1');
    expect(marks.finish).toHaveBeenCalledWith('a1');
    task.cancel();
    await task.toPromise();
  });

  it('marks and ends a divider session when its tab closes', async () => {
    const channel = stdChannel();
    let current = snapshot({ dividerSessionAgentIds: ['a1'], openAgentTabIds: ['a1'] });
    const dispatch = vi.fn();
    const { task } = startSaga(channel, dispatch, () => state(current));
    await settle();
    current = snapshot({ dividerSessionAgentIds: ['a1'] });
    channel.put(closeTab('ws-1', 'tab-a1'));
    await settle();
    expect(marks.boundary).toHaveBeenCalledWith(['a1']);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'unreadTracking/endDividerSession',
      payload: ['a1'],
    });
    task.cancel();
    await task.toPromise();
  });

  it('marks and ends a Chief divider session when the sidebar panel closes', async () => {
    const channel = stdChannel();
    let current = snapshot({
      chiefCardVisible: true,
      chiefSessionAgentIds: ['chief-1'],
      dividerSessionAgentIds: ['chief-1'],
    });
    const dispatch = vi.fn();
    const { task } = startSaga(channel, dispatch, () => state(current));
    await settle();
    current = snapshot({
      chiefSessionAgentIds: ['chief-1'],
      dividerSessionAgentIds: ['chief-1'],
    });
    channel.put(closePanel());
    await settle();
    expect(marks.boundary).toHaveBeenCalledWith(['chief-1']);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'unreadTracking/endDividerSession',
      payload: ['chief-1'],
    });
    task.cancel();
    await task.toPromise();
  });

  it('routes workspace boundaries from the selected workspace', async () => {
    const channel = stdChannel();
    let current = snapshot({
      activeWorkspaceId: 'ws-1',
      dividerSessionAgentIds: ['a1'],
    });
    const dispatch = vi.fn();
    const { task, notify } = startSaga(channel, dispatch, () => state(current));
    await settle();

    expect(marks.boundary).not.toHaveBeenCalled();
    current = { ...current, activeWorkspaceId: 'ws-2' };
    notify();
    await settle();

    expect(marks.boundary).toHaveBeenCalledWith(['a1']);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'unreadTracking/endDividerSession',
      payload: ['a1'],
    });
    task.cancel();
    await task.toPromise();
  });

  it('routes clearing the selected workspace', async () => {
    const channel = stdChannel();
    let current = snapshot({
      activeWorkspaceId: 'ws-1',
      dividerSessionAgentIds: ['a1'],
    });
    const dispatch = vi.fn();
    const { task, notify } = startSaga(channel, dispatch, () => state(current));
    await settle();

    expect(marks.boundary).not.toHaveBeenCalled();
    current = { ...current, activeWorkspaceId: null };
    notify();
    await settle();

    expect(marks.boundary).toHaveBeenCalledWith(['a1']);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'unreadTracking/endDividerSession',
      payload: ['a1'],
    });
    task.cancel();
    await task.toPromise();
  });

  it('clears the cached chat scroll for affected agents on tab close', async () => {
    // Regression (top-landing on re-entry): a stale cached position must not
    // survive a tab-close boundary — the next open lands at the bottom or
    // the divider, not at a clamped old scrollTop.
    setCachedChatScroll('ws-1', 'a1', { scrollTop: 987, shouldFollowBottom: false });
    setCachedChatScroll('ws-1', 'other', { scrollTop: 55, shouldFollowBottom: false });
    const channel = stdChannel();
    let current = snapshot({ dividerSessionAgentIds: ['a1'], openAgentTabIds: ['a1'] });
    const { task } = startSaga(channel, vi.fn(), () => state(current));
    await settle();
    current = snapshot({ dividerSessionAgentIds: ['a1'] });
    channel.put(closeTab('ws-1', 'tab-a1'));
    await settlePastTeardown();
    expect(getCachedChatScroll('ws-1', 'a1')).toBeUndefined();
    expect(getCachedChatScroll('ws-1', 'other')).toEqual({
      scrollTop: 55,
      shouldFollowBottom: false,
    });
    task.cancel();
    await task.toPromise();
  });

  it('wins over the departing panel destroy-time cache write after the boundary', async () => {
    // Regression: Svelte flushes the closing ChatPanel's onDestroy in a
    // microtask AFTER the boundary action dispatches, and that write must not
    // repopulate the entry the boundary just cleared. A synchronous clear
    // loses this race; the deferred clear must win.
    setCachedChatScroll('ws-1', 'a1', { scrollTop: 987, shouldFollowBottom: false });
    const channel = stdChannel();
    let current = snapshot({ dividerSessionAgentIds: ['a1'], openAgentTabIds: ['a1'] });
    const { task } = startSaga(channel, vi.fn(), () => state(current));
    await settle();
    current = snapshot({ dividerSessionAgentIds: ['a1'] });
    channel.put(closeTab('ws-1', 'tab-a1'));
    // Emulate the departing panel's teardown flush: a microtask-scheduled
    // destroy-time cache write landing after the boundary was handled.
    await Promise.resolve();
    setCachedChatScroll('ws-1', 'a1', { scrollTop: 987, shouldFollowBottom: false });
    await settlePastTeardown();
    expect(getCachedChatScroll('ws-1', 'a1')).toBeUndefined();
    task.cancel();
    await task.toPromise();
  });

  it('clears the cached chat scroll for affected agents on workspace switch', async () => {
    setCachedChatScroll('ws-1', 'a1', { scrollTop: 987, shouldFollowBottom: false });
    const channel = stdChannel();
    let current = snapshot({ activeWorkspaceId: 'ws-1', dividerSessionAgentIds: ['a1'] });
    const { task, notify } = startSaga(channel, vi.fn(), () => state(current));
    await settle();
    current = { ...current, activeWorkspaceId: 'ws-2' };
    notify();
    await settlePastTeardown();
    expect(getCachedChatScroll('ws-1', 'a1')).toBeUndefined();
    task.cancel();
    await task.toPromise();
  });

  it('keeps the cached chat scroll on a chief-card-close boundary', async () => {
    setCachedChatScroll('ws-1', 'chief-1', { scrollTop: 321, shouldFollowBottom: false });
    const channel = stdChannel();
    let current = snapshot({
      chiefCardVisible: true,
      chiefSessionAgentIds: ['chief-1'],
      dividerSessionAgentIds: ['chief-1'],
    });
    const { task } = startSaga(channel, vi.fn(), () => state(current));
    await settle();
    current = snapshot({
      chiefSessionAgentIds: ['chief-1'],
      dividerSessionAgentIds: ['chief-1'],
    });
    channel.put(closePanel());
    await settle();
    expect(getCachedChatScroll('ws-1', 'chief-1')).toEqual({
      scrollTop: 321,
      shouldFollowBottom: false,
    });
    task.cancel();
    await task.toPromise();
  });

  it('records the watched streaming tail when a boundary hits a live-streaming agent', async () => {
    const channel = stdChannel();
    let current = snapshot({ dividerSessionAgentIds: ['a1'], openAgentTabIds: ['a1'] });
    const dispatch = vi.fn();
    const agentSessionsByAgentId = {
      a1: {
        isStreaming: true,
        messages: [
          { id: 'msg-1', role: 'user', isStreaming: false },
          { id: 'msg-2', role: 'assistant', isStreaming: true },
        ],
      },
    };
    const { task } = startSaga(channel, dispatch, () => state(current, agentSessionsByAgentId));
    await settle();
    current = snapshot({ dividerSessionAgentIds: ['a1'] });
    channel.put(closeTab('ws-1', 'tab-a1'));
    await settle();
    expect(dispatch).toHaveBeenCalledWith({
      type: 'unreadTracking/recordWatchedStreamingTail',
      payload: ['a1', 'msg-1'],
    });
    task.cancel();
    await task.toPromise();
  });

  it('does not record a watched streaming tail when a persisted message follows the streaming assistant row (interrupt-priority send)', async () => {
    const channel = stdChannel();
    let current = snapshot({ dividerSessionAgentIds: ['a1'], openAgentTabIds: ['a1'] });
    const dispatch = vi.fn();
    const agentSessionsByAgentId = {
      a1: {
        isStreaming: true,
        messages: [
          { id: 'msg-1', role: 'assistant', isStreaming: true },
          { id: 'msg-2', role: 'user', isStreaming: false },
        ],
      },
    };
    const { task } = startSaga(channel, dispatch, () => state(current, agentSessionsByAgentId));
    await settle();
    current = snapshot({ dividerSessionAgentIds: ['a1'] });
    channel.put(closeTab('ws-1', 'tab-a1'));
    await settle();
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'unreadTracking/recordWatchedStreamingTail' }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('does not record a watched streaming tail when the agent has no live stream', async () => {
    const channel = stdChannel();
    let current = snapshot({ dividerSessionAgentIds: ['a1'], openAgentTabIds: ['a1'] });
    const dispatch = vi.fn();
    const agentSessionsByAgentId = {
      a1: {
        isStreaming: false,
        messages: [{ id: 'msg-1', role: 'assistant', isStreaming: false }],
      },
    };
    const { task } = startSaga(channel, dispatch, () => state(current, agentSessionsByAgentId));
    await settle();
    current = snapshot({ dividerSessionAgentIds: ['a1'] });
    channel.put(closeTab('ws-1', 'tab-a1'));
    await settle();
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'unreadTracking/recordWatchedStreamingTail' }),
    );
    task.cancel();
    await task.toPromise();
  });
});

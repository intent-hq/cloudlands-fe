import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import { describe, expect, it } from 'vitest';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import {
  chatPanelRetryAgentFinished,
  chatPanelRetryAgentRequested,
  chatPanelUiReducer,
  chatPanelUiReleased,
  userMessageIndexFinished,
  userMessageIndexRequested,
} from './chat-panel-ui-slice';

const WS = 'workspace-a';
const CONSUMER = 'panel-a';
const AGENT = 'agent-a';

describe('chatPanelUiReducer', () => {
  it('starts empty', () => {
    expect(chatPanelUiReducer(undefined, { type: 'test' })).toEqual({ byWorkspaceId: {} });
  });

  it('keeps user-message index outcomes request- and consumer-correlated', () => {
    let state = chatPanelUiReducer(
      undefined,
      userMessageIndexRequested(WS, CONSUMER, 'request-1', AGENT, 4),
    );
    expect(getItem(state.byWorkspaceId[WS].userMessageIndexes, CONSUMER)).toEqual({
      id: CONSUMER,
      requestId: 'request-1',
      agentId: AGENT,
      epoch: 4,
      status: 'pending',
    });

    const stale = chatPanelUiReducer(
      state,
      userMessageIndexFinished(WS, CONSUMER, 'older', 'succeeded', {
        ok: true,
        items: [],
        total: 0,
      }),
    );
    expect(stale).toBe(state);

    state = chatPanelUiReducer(
      state,
      userMessageIndexFinished(WS, CONSUMER, 'request-1', 'succeeded', {
        ok: true,
        items: [{ id: 'm1', preview: 'hello', createdAt: '2026-01-01T00:00:00.000Z' }],
        total: 1,
      }),
    );
    expect(getItem(state.byWorkspaceId[WS].userMessageIndexes, CONSUMER)).toMatchObject({
      requestId: 'request-1',
      status: 'succeeded',
      result: { ok: true, total: 1 },
    });

    state = chatPanelUiReducer(
      state,
      userMessageIndexRequested(WS, CONSUMER, 'request-2', AGENT, 4),
    );
    expect(getItem(state.byWorkspaceId[WS].userMessageIndexes, CONSUMER)).toMatchObject({
      requestId: 'request-2',
      status: 'pending',
      result: { ok: true, total: 1 },
    });
  });

  it('isolates retry outcomes between panels and rejects stale settlements', () => {
    let state = chatPanelUiReducer(
      undefined,
      chatPanelRetryAgentRequested(WS, 'panel-a', 'request-a', AGENT),
    );
    state = chatPanelUiReducer(
      state,
      chatPanelRetryAgentRequested(WS, 'panel-b', 'request-b', AGENT),
    );
    const stale = chatPanelUiReducer(
      state,
      chatPanelRetryAgentFinished(WS, 'panel-a', 'older', 'failed', 'late failure'),
    );
    expect(stale).toBe(state);

    state = chatPanelUiReducer(
      state,
      chatPanelRetryAgentFinished(WS, 'panel-a', 'request-a', 'cancelled'),
    );
    state = chatPanelUiReducer(
      state,
      chatPanelRetryAgentFinished(WS, 'panel-b', 'request-b', 'failed', 'rejected'),
    );
    expect(getItem(state.byWorkspaceId[WS].retryAgents, 'panel-a')).toMatchObject({
      status: 'cancelled',
    });
    expect(getItem(state.byWorkspaceId[WS].retryAgents, 'panel-b')).toMatchObject({
      status: 'failed',
      error: 'rejected',
    });
  });

  it('releases one panel without touching another', () => {
    let state = chatPanelUiReducer(
      undefined,
      userMessageIndexRequested(WS, 'panel-a', 'index-a', AGENT, 0),
    );
    state = chatPanelUiReducer(
      state,
      chatPanelRetryAgentRequested(WS, 'panel-a', 'retry-a', AGENT),
    );
    state = chatPanelUiReducer(
      state,
      userMessageIndexRequested(WS, 'panel-b', 'index-b', AGENT, 0),
    );
    state = chatPanelUiReducer(state, chatPanelUiReleased(WS, 'panel-a'));

    expect(getItem(state.byWorkspaceId[WS].userMessageIndexes, 'panel-a')).toBeUndefined();
    expect(getItem(state.byWorkspaceId[WS].retryAgents, 'panel-a')).toBeUndefined();
    expect(getItem(state.byWorkspaceId[WS].userMessageIndexes, 'panel-b')).toBeDefined();
  });

  it('clears all outcomes when the workspace unmounts', () => {
    const state = chatPanelUiReducer(
      undefined,
      userMessageIndexRequested(WS, CONSUMER, 'request-1', AGENT, 0),
    );
    expect(chatPanelUiReducer(state, workspaceUnmounted(WS)).byWorkspaceId[WS]).toBeUndefined();
  });
});

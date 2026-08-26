import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentStatus } from '$shared/types/agent.types';
import type { AgentSession } from '$shared/types';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import type { ReduxStoreContext } from '$store/renderer/types';
import { initAppStore, store } from '$store/renderer/store';
import {
  bulkUpsertSessions,
  removeSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { selectAgentSession } from '$store/renderer/slices/agent-session/agent-session-selectors';
import { preview } from './mention-agent-avatar.preview';

vi.mock('./MentionAgentAvatar.svelte', () => ({ default: vi.fn() }));

const fixtureAgentId = AgentId('preview-agent-avatar');
const unrelatedAgentId = AgentId('preview-unrelated-agent');
const workspaceId = WorkspaceId('preview-test-workspace');
const timestamp = '2026-08-23T12:00:00.000Z';
let storeContext: ReduxStoreContext | undefined;

function session(id: ReturnType<typeof AgentId>) {
  return selectAgentSession.select(store.state, id);
}

beforeEach(() => {
  storeContext = initAppStore(store);
});

afterEach(() => {
  store.dispatch(removeSession(fixtureAgentId));
  store.dispatch(removeSession(unrelatedAgentId));
  storeContext?.dispose();
  storeContext = undefined;
});

describe('mention agent avatar preview fixture', () => {
  it('preserves unrelated sessions while states change and after cleanup', () => {
    const unrelated: AgentSession = {
      id: unrelatedAgentId,
      backendSessionId: null,
      workspaceId,
      name: 'Unrelated agent',
      status: AgentStatus.RuntimeIdle,
      messages: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    store.dispatch(bulkUpsertSessions([unrelated]));

    let cleanup: (() => void) | undefined;
    for (const [state, status] of [
      ['idle', AgentStatus.RuntimeIdle],
      ['waiting', AgentStatus.Waiting],
      ['error', AgentStatus.Error],
    ] as const) {
      cleanup?.();
      cleanup = preview.states[state].setup?.() || undefined;
      expect(session(fixtureAgentId)?.status).toBe(status);
      expect(session(unrelatedAgentId)?.name).toBe('Unrelated agent');
    }

    cleanup?.();
    expect(session(fixtureAgentId)).toBeUndefined();
    expect(session(unrelatedAgentId)?.name).toBe('Unrelated agent');
  });
});

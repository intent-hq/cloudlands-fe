/**
 * Regression test: ChiefCard agentId access must be null-safe.
 *
 * The chat block's `{#key}` and `agentId` prop expressions are lazy getters
 * that re-evaluate when read (including from ChatPanel during its own
 * teardown). If they dereference `activeThread` without a guard, emptying the
 * chief thread list while ChatPanel is mounted throws
 * "Cannot read properties of null (reading 'agentId')".
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/svelte';
import { store as appStore } from '$store/renderer/store';
import {
  bulkUpsertSessions,
  removeSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { AgentId, CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { AgentStatus, type AgentSession } from '$shared/types';
import ChiefCard from '../cards/ChiefCard.svelte';

vi.mock('$lib/components/chat/ChatPanel.svelte', async () => ({
  default: (await import('./mocks/MockChiefChatPanel.svelte')).default,
}));

const agentId = 'agent-chief-null-safety';

function makeChiefSession(): AgentSession {
  return {
    id: AgentId(agentId),
    backendSessionId: null,
    workspaceId: CHIEF_WORKSPACE_ID,
    name: 'Chief thread',
    status: AgentStatus.Active,
    messages: [],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  } as AgentSession;
}

describe('ChiefCard null-safe agentId access', () => {
  beforeEach(() => {
    appStore.init();
    appStore.dispatch(bulkUpsertSessions([makeChiefSession()]));
  });

  afterEach(() => {
    cleanup();
    appStore.dispatch(removeSession(agentId));
  });

  it('unmounts the chat block without throwing when the thread list empties', async () => {
    // The store→readable propagation is asynchronous, so an unguarded null
    // dereference surfaces as an uncaught error in the flush, not a sync
    // throw — capture window errors to assert none fire.
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent) => {
      errors.push(event.error ?? event.message);
      event.preventDefault();
    };
    window.addEventListener('error', onError);

    try {
      const { queryByTestId } = render(ChiefCard, { props: { expanded: true } });
      await waitFor(() => expect(queryByTestId('mock-chat-panel')).not.toBeNull());

      appStore.dispatch(removeSession(agentId));

      await waitFor(() => expect(queryByTestId('mock-chat-panel')).toBeNull());
      expect(errors).toEqual([]);
    } finally {
      window.removeEventListener('error', onError);
    }
  });
});

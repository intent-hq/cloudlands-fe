/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';

import EnhancedMentionList from '../EnhancedMentionList.svelte';
import { store as appStore } from '$store/renderer/store';
import {
  bulkUpsertSessions,
  removeSession,
  updateSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import type { AgentSession } from '$shared/types';
import { AgentStatus } from '$shared/types';

const agentId = 'mention-agent-live';

function session(): AgentSession {
  return {
    id: agentId,
    backendSessionId: 'mention-backend-live',
    workspaceId: 'mention-workspace-live',
    name: 'Live Mention Agent',
    status: AgentStatus.Idle,
    messages: [],
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
  } as AgentSession;
}

describe('EnhancedMentionList agent avatar state', () => {
  beforeEach(() => {
    appStore.init();
    appStore.dispatch(bulkUpsertSessions([session()]));
  });

  afterEach(() => {
    appStore.dispatch(removeSession(agentId));
  });

  it('reacts to Redux state transitions without replacing the mention row or avatar', async () => {
    const view = render(EnhancedMentionList, {
      props: {
        items: [
          {
            id: agentId,
            type: 'agent',
            label: 'Live Mention Agent',
            uri: `agent://${agentId}`,
            group: 'Agents',
            meta: { workspaceId: 'mention-workspace-live' },
          },
        ],
        command: vi.fn(),
      },
    });

    const row = view.container.querySelector('.mention-item');
    const avatar = view.container.querySelector('[data-agent-avatar-with-state]');
    expect(row).not.toBeNull();
    expect(avatar?.getAttribute('data-avatar-state')).toBe('idle');

    appStore.dispatch(
      updateSession(agentId, { status: AgentStatus.Processing, isResponding: true }),
    );
    await waitFor(() => expect(avatar?.getAttribute('data-avatar-state')).toBe('running'));

    appStore.dispatch(
      updateSession(agentId, {
        status: AgentStatus.Waiting,
        isResponding: false,
        isStreaming: false,
        isProcessing: false,
      }),
    );
    await waitFor(() => expect(avatar?.getAttribute('data-avatar-state')).toBe('waiting'));

    appStore.dispatch(
      updateSession(agentId, {
        status: AgentStatus.Active,
        isResponding: true,
        isWaitingOnTool: true,
      }),
    );
    await waitFor(() => expect(avatar?.getAttribute('data-avatar-state')).toBe('running'));

    expect(view.container.querySelector('.mention-item')).toBe(row);
    expect(view.container.querySelector('[data-agent-avatar-with-state]')).toBe(avatar);
  });
});

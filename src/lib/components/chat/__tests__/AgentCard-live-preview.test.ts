/**
 * @vitest-environment jsdom
 *
 * AgentCard — live preview precedence for the footer/sidebar row
 * (intentd#792 push-applied `agent:stream:activity` fields).
 *
 * Renders the REAL component against the REAL configured store and asserts
 * the preview line's source precedence:
 *   1. the viewed-agent chat.subscribe streaming buffer (character-level),
 *   2. the session's push-applied `lastAgentResponse` while responding,
 *   3. the transcript-derived peek text otherwise.
 */
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';

import AgentCard from '../AgentCard.svelte';
import { store as appStore } from '$store/renderer/store';
import {
  bulkUpsertSessions,
  removeSession,
  updateSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import type { AgentMessage, AgentSession } from '$shared/types';
import { AgentStatus } from '$shared/types';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';

// Distinct agent id per test: the configured store is a process singleton and
// the upsert no-op guard (`isSessionEquivalent`) can drop re-upserts.
let testAgentSeq = 0;
let agentId = '';

function assistantMessage(text: string, overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: `msg-${testAgentSeq}`,
    role: 'assistant',
    contentBlocks: [{ type: 'text', text }],
    timestamp: '2026-07-01T00:00:00.000Z',
    ...overrides,
  } as AgentMessage;
}

function seedSession(overrides: Partial<AgentSession> = {}): void {
  appStore.dispatch(
    bulkUpsertSessions([
      {
        id: AgentId(agentId),
        backendSessionId: 'backend-1',
        workspaceId: WorkspaceId('ws-preview-1'),
        name: 'Watched Agent',
        status: AgentStatus.Active,
        messages: [],
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
        ...overrides,
      } as AgentSession,
    ]),
  );
}

describe('AgentCard live preview precedence', () => {
  beforeEach(() => {
    appStore.init();
    agentId = `agent-preview-${++testAgentSeq}`;
  });

  afterEach(() => {
    appStore.dispatch(removeSession(agentId));
  });

  it('prefers the session lastAgentResponse over stale transcript peek text while responding', async () => {
    // Non-viewed watched agent: the persisted transcript froze on the last
    // turn's text; the activity ping push-applied fresher preview text.
    seedSession({
      isStreaming: true,
      messages: [assistantMessage('stale persisted text from last turn')],
    });
    appStore.dispatch(
      updateSession(agentId, { lastAgentResponse: 'fresh mid-turn activity text' }),
    );

    render(AgentCard, { props: { agentId } });

    const preview = await screen.findByTestId('agent-card-preview');
    expect(preview.textContent).toContain('fresh mid-turn activity text');
    expect(preview.textContent).not.toContain('stale persisted text');
  });

  it('lets the viewed-agent chat.subscribe streaming buffer win over lastAgentResponse', async () => {
    // Viewed agent: the standing chat.subscribe stream grows a live
    // (isStreaming) assistant message — that buffer stays authoritative.
    seedSession({
      isStreaming: true,
      messages: [assistantMessage('character-level buffer text', { isStreaming: true })],
    });
    appStore.dispatch(
      updateSession(agentId, { lastAgentResponse: 'coarser activity preview' }),
    );

    render(AgentCard, { props: { agentId } });

    const preview = await screen.findByTestId('agent-card-preview');
    expect(preview.textContent).toContain('character-level buffer text');
    expect(preview.textContent).not.toContain('coarser activity preview');
  });

  it('falls back to the transcript-derived peek text when the agent is not responding', async () => {
    // Idle agent: the turn's final text is in the transcript; a leftover
    // lastAgentResponse from the finished turn must not override it.
    seedSession({
      isStreaming: false,
      status: AgentStatus.Idle,
      messages: [assistantMessage('final persisted answer')],
    });
    appStore.dispatch(updateSession(agentId, { lastAgentResponse: 'mid-turn leftover' }));

    render(AgentCard, { props: { agentId } });

    const preview = await screen.findByTestId('agent-card-preview');
    expect(preview.textContent).toContain('final persisted answer');
    expect(preview.textContent).not.toContain('mid-turn leftover');
  });

  it('shows the live session digest while responding (over the preview line)', async () => {
    seedSession({
      isStreaming: true,
      messages: [assistantMessage('stale persisted text')],
    });
    appStore.dispatch(updateSession(agentId, { digest: 'Parser rewrite in progress' }));

    render(AgentCard, { props: { agentId } });

    expect(await screen.findByText('Parser rewrite in progress')).toBeTruthy();
    expect(screen.queryByTestId('agent-card-preview')).toBeNull();
  });
});

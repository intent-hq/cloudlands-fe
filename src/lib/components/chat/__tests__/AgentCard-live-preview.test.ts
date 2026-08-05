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
import { streamActivityReceived } from '$store/renderer/slices/chat-state/chat-state-slice';
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
    appStore.dispatch(streamActivityReceived(agentId, true));
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
    appStore.dispatch(updateSession(agentId, { lastAgentResponse: 'coarser activity preview' }));

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

describe('AgentCard user-message-newest preview (freshness wins)', () => {
  beforeEach(() => {
    appStore.init();
    agentId = `agent-preview-${++testAgentSeq}`;
  });

  afterEach(() => {
    appStore.dispatch(removeSession(agentId));
  });

  function userMessage(text: string): AgentMessage {
    return {
      id: `user-msg-${testAgentSeq}`,
      role: 'user',
      contentBlocks: [{ type: 'text', text }],
      // Well outside the reducer's near-simultaneous user-reply reorder
      // window so the seeded [assistant, user] ordering is preserved.
      timestamp: '2026-07-01T00:10:00.000Z',
    } as AgentMessage;
  }

  it('previews the first line of the wire lastUserMessage on a PROTOCOL-shaped AgentLite (beats stale response + completion report)', async () => {
    // agent.list/agent.get projection: no transcript, wire-only preview
    // fields (PROTOCOL §5.5 AgentLite with the additive lastMessageRole).
    seedSession({
      status: AgentStatus.Idle,
      isStreaming: false,
      messages: [],
      lastUserMessage: 'follow-up question first line\nsecond line detail',
      lastMessageRole: 'user',
      lastAgentResponse: 'stale answer from the finished turn',
      metadata: { completionReport: 'old completion report' } as AgentSession['metadata'],
    });

    render(AgentCard, { props: { agentId } });

    const preview = await screen.findByTestId('agent-card-preview');
    expect(preview.textContent).toContain('follow-up question first line');
    expect(preview.textContent).not.toContain('second line detail');
    expect(screen.queryByText('old completion report')).toBeNull();
    expect(screen.queryByText(/stale answer/)).toBeNull();
  });

  it('strips multiple leading bracketed prefixes from the user line', async () => {
    seedSession({
      status: AgentStatus.Idle,
      isStreaming: false,
      messages: [],
      lastUserMessage: '[Currently viewing: foo.ts] [panel: chat] the actual question',
      lastMessageRole: 'user',
    });

    render(AgentCard, { props: { agentId } });

    const preview = await screen.findByTestId('agent-card-preview');
    expect(preview.textContent).toContain('the actual question');
    expect(preview.textContent).not.toContain('Currently viewing');
    expect(preview.textContent).not.toContain('panel: chat');
  });

  it('previews the user first line via the transcript-derived fallback when the wire field is absent', async () => {
    seedSession({
      status: AgentStatus.Idle,
      isStreaming: false,
      messages: [
        assistantMessage('previous assistant answer'),
        userMessage('new user question\nwith a second line'),
      ],
    });

    render(AgentCard, { props: { agentId } });

    const preview = await screen.findByTestId('agent-card-preview');
    expect(preview.textContent).toContain('new user question');
    expect(preview.textContent).not.toContain('with a second line');
    expect(preview.textContent).not.toContain('previous assistant answer');
  });

  it('keeps the user first line mid-turn while no streamed text exists yet (beats a leftover digest)', async () => {
    seedSession({
      isStreaming: true,
      messages: [],
      lastUserMessage: 'just sent this',
      lastMessageRole: 'user',
    });
    appStore.dispatch(updateSession(agentId, { digest: 'digest from a previous turn' }));

    render(AgentCard, { props: { agentId } });

    const preview = await screen.findByTestId('agent-card-preview');
    expect(preview.textContent).toContain('just sent this');
    expect(screen.queryByText('digest from a previous turn')).toBeNull();
  });

  it('resumes the live preview once streamed text lands (push-applied lastAgentResponse)', async () => {
    seedSession({
      isStreaming: true,
      messages: [],
      lastUserMessage: 'just sent this',
      lastMessageRole: 'user',
    });
    // Text-bearing activity ping: flips the per-turn receivedFirstChunk flag
    // and push-applies the fresh response text.
    appStore.dispatch(streamActivityReceived(agentId, true));
    appStore.dispatch(updateSession(agentId, { lastAgentResponse: 'streaming text now' }));

    render(AgentCard, { props: { agentId } });

    const preview = await screen.findByTestId('agent-card-preview');
    expect(preview.textContent).toContain('streaming text now');
    expect(preview.textContent).not.toContain('just sent this');
  });

  it('keeps the user first line on turn 2 despite a leftover previous-turn lastAgentResponse', async () => {
    // Regression: nothing clears the session's push-applied lastAgentResponse
    // at turn start, so pre-first-token the per-turn receivedFirstChunk flag
    // (reset by agent:stream:end) is what distinguishes leftover text from
    // text streamed this turn.
    seedSession({
      isStreaming: true,
      messages: [],
      lastUserMessage: 'second turn question',
      lastMessageRole: 'user',
      lastAgentResponse: 'final text from turn one',
    });

    render(AgentCard, { props: { agentId } });

    const preview = await screen.findByTestId('agent-card-preview');
    expect(preview.textContent).toContain('second turn question');
    expect(preview.textContent).not.toContain('final text from turn one');
  });

  it('resumes the agent-side preview once the assistant reply lands (lastMessageRole flips)', async () => {
    seedSession({
      status: AgentStatus.Idle,
      isStreaming: false,
      messages: [userMessage('the question'), assistantMessage('the final answer')],
      lastMessageRole: 'assistant',
    });

    render(AgentCard, { props: { agentId } });

    const preview = await screen.findByTestId('agent-card-preview');
    expect(preview.textContent).toContain('the final answer');
    expect(preview.textContent).not.toContain('the question');
  });

  it('leaves an AgentLite-only session without lastMessageRole unchanged (older daemon: no preview)', async () => {
    seedSession({
      status: AgentStatus.Idle,
      isStreaming: false,
      messages: [],
      lastUserMessage: 'wire-only user text',
    });

    render(AgentCard, { props: { agentId } });

    await screen.findByText('Watched Agent');
    expect(screen.queryByTestId('agent-card-preview')).toBeNull();
  });
});

describe('AgentCard this-turn live text vs previous-turn report (monorepo#1327)', () => {
  beforeEach(() => {
    appStore.init();
    agentId = `agent-preview-${++testAgentSeq}`;
  });

  afterEach(() => {
    appStore.dispatch(removeSession(agentId));
  });

  it('lets this-turn live text outrank the previous turn completion report while responding', async () => {
    // Regression: a delegated agent finished a task (reportToParent left a
    // completionReport in metadata), then picked up a queued follow-up. Once
    // the new turn streams text (per-turn receivedFirstChunk flip + push-
    // applied lastAgentResponse), the preview must show the new turn's text,
    // not the stale report.
    seedSession({
      isStreaming: true,
      messages: [],
      metadata: {
        completionReport: 'old completion report from turn one',
      } as AgentSession['metadata'],
    });
    appStore.dispatch(streamActivityReceived(agentId, true));
    appStore.dispatch(updateSession(agentId, { lastAgentResponse: 'fresh second-turn text' }));

    render(AgentCard, { props: { agentId } });

    const preview = await screen.findByTestId('agent-card-preview');
    expect(preview.textContent).toContain('fresh second-turn text');
    expect(screen.queryByText('old completion report from turn one')).toBeNull();
  });

  it('suppresses previous-turn summaries in the busy no-text window (falls to the tool preview)', async () => {
    // Regression: child completed with reportToParent (completionReport in
    // metadata + transcript digest), parent sent a follow-up, and the new
    // turn does tool-only work — no text yet, so no receivedFirstChunk flip.
    // While responding, the stale summaries must never be the preview; the
    // chain falls through to the latest tool_use preview instead.
    seedSession({
      isStreaming: true,
      messages: [
        assistantMessage('wrapped up <agent_digest>old transcript digest</agent_digest>', {
          contentBlocks: [
            {
              type: 'text',
              text: 'wrapped up <agent_digest>old transcript digest</agent_digest>',
            },
            { type: 'tool_use', id: 'tool-1', name: 'view', input: { path: 'src/foo.ts' } },
          ],
        }),
      ],
      metadata: { completionReport: 'report from the last turn' } as AgentSession['metadata'],
    });

    render(AgentCard, {
      props: { agentId, lastResponseSummary: 'summary from the last turn' },
    });

    // Pin the preview to the tool label (classifyTool subject for the seeded
    // tool_use) so a regression to lastResponse/lastUserMsg cannot pass.
    const preview = await screen.findByTestId('agent-card-preview');
    expect(preview.textContent).toMatch(/foo\.ts/);
    expect(screen.queryByText(/old transcript digest/)).toBeNull();
    expect(screen.queryByText('report from the last turn')).toBeNull();
    expect(screen.queryByText('summary from the last turn')).toBeNull();
  });

  it('shows no stale report while responding with no fresher content at all', async () => {
    // Busy no-text window with nothing fresher to show: an empty preview
    // beats resurrecting the previous turn's report/summary.
    seedSession({
      isStreaming: true,
      messages: [],
      metadata: { completionReport: 'report from the last turn' } as AgentSession['metadata'],
    });

    render(AgentCard, {
      props: {
        agentId,
        completionReport: 'prop completion report',
        lastResponseSummary: 'prop summary',
      },
    });

    await screen.findByText('Watched Agent');
    expect(screen.queryByText('report from the last turn')).toBeNull();
    expect(screen.queryByText('prop completion report')).toBeNull();
    expect(screen.queryByText('prop summary')).toBeNull();
    expect(screen.queryByTestId('agent-card-preview')).toBeNull();
  });

  it('still shows the last completion report for an idle agent (no fresher content)', async () => {
    // Idle between turns: a leftover lastAgentResponse must not displace the
    // report — liveResponseLine only exists while the agent is responding.
    seedSession({
      status: AgentStatus.Idle,
      isStreaming: false,
      messages: [],
      metadata: {
        completionReport: 'final report of the finished task',
      } as AgentSession['metadata'],
      lastAgentResponse: 'leftover mid-turn text',
    });

    render(AgentCard, { props: { agentId } });

    expect(await screen.findByText('final report of the finished task')).toBeTruthy();
    expect(screen.queryByText(/leftover mid-turn text/)).toBeNull();
  });
});

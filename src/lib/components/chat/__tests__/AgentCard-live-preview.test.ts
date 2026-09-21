/**
 * @vitest-environment jsdom
 *
 * AgentCard — live preview precedence for the footer/sidebar row
 * (intentd#792 push-applied `agent:stream:activity` fields).
 *
 * Renders the REAL component against the REAL configured store and asserts
 * the preview line's source precedence:
 *   1. the session's push-applied `lastAgentResponse` while responding
 *      (refreshed ~1s by `agent:stream:activity`; server-cleaned),
 *   2. the wire `lastAgentResponse` (AgentLite, PROTOCOL §5.5) otherwise —
 *      stream buffers and the loaded transcript are never consulted to
 *      re-derive previews (monorepo#2843).
 */
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';

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

  it('places the timestamp at the right edge of the standard header row', async () => {
    seedSession({
      status: AgentStatus.Idle,
      messages: [assistantMessage('second-row preview text')],
      lastAgentResponse: 'second-row preview text',
    });

    const { container } = render(AgentCard, { props: { agentId } });

    const preview = await screen.findByTestId('agent-card-preview');
    const header = container.querySelector('.agent-card-header');
    const timestamp = header?.querySelector('[data-relative-time]') ?? header?.lastElementChild;
    expect(preview).toBeTruthy();
    expect(header).not.toBeNull();
    expect(timestamp).not.toBeNull();
    expect(header?.contains(timestamp)).toBe(true);
  });

  it('reserves a non-clipping trailing slot for task progress outside row navigation', async () => {
    seedSession({
      name: 'A very long watched agent name that must truncate',
      lastAgentResponse: 'A long preview that must keep its own truncation behavior',
    });

    const { container } = render(AgentCard, {
      props: {
        agentId,
        inline: true,
        taskProgress: [
          { id: 'running', title: 'Run the focused task', status: 'running' },
          { id: 'done', title: 'Finish setup', status: 'completed' },
          { id: 'pending-1', title: 'Check alignment', status: 'pending' },
          { id: 'pending-2', title: 'Check spacing', status: 'pending' },
          { id: 'pending-3', title: 'Check overflow', status: 'pending' },
          { id: 'pending-4', title: 'Check scrolling', status: 'pending' },
          { id: 'pending-5', title: 'Check focus', status: 'pending' },
        ],
      },
    });

    const trigger = await screen.findByTestId('task-progress-trigger');
    const activationButton = container.querySelector('[data-testid="agent-list-item"] > button');
    const content = container.querySelector('.agent-card-content');
    const trailing = screen.getByTestId('agent-card-trailing-slot');
    expect(trigger.getAttribute('aria-label')).toBe('Task progress: 1 of 7 completed');
    expect(trigger.className).toContain('h-(--row-action-target-compact)');
    expect(trigger.className).toContain('min-w-(--row-action-target-compact)');
    expect(trigger.className).toContain('w-fit');
    expect(
      within(trigger)
        .getAllByTestId('task-progress-status-icon')
        .map((icon) => icon.dataset.taskStatus),
    ).toEqual(['completed', 'pending', 'pending', 'running']);
    expect(within(trigger).getAllByTestId('task-progress-stack-item')).toHaveLength(5);
    expect(
      within(trigger)
        .getAllByTestId('task-progress-status-icon')
        .every((icon) => icon.className.includes('size-3.5') && !icon.className.includes('size-4')),
    ).toBe(true);
    expect(activationButton?.contains(trigger)).toBe(false);
    expect(activationButton?.className).toContain('overflow-hidden');
    expect(content?.className).toContain('mr-11');
    expect(trailing.className).toContain('w-11');
    expect(screen.getByTestId('agent-card-name').className).toContain('shrink-0');
    expect(screen.getByTestId('agent-card-preview').className).toContain('truncate');

    trigger.focus();
    expect(screen.queryByRole('dialog', { name: 'Agent tasks' })).toBeNull();
    await fireEvent.click(trigger);
    expect(await screen.findByRole('dialog', { name: 'Agent tasks' })).toBeTruthy();
    expect(document.activeElement).toBe(trigger);
  });

  it('serves the pushed wire preview over a streaming buffer ending in suggested prompts', async () => {
    // Regression (monorepo#2843): the viewed-agent chat.subscribe buffer is
    // never consulted — a buffer ending in a multi-line suggested-prompts
    // block must never surface a prompt line; the server-cleaned pushed
    // lastAgentResponse is the sole live source.
    seedSession({
      isStreaming: true,
      messages: [
        assistantMessage(
          'The prose answer.\n<!-- suggested-prompts\n- Try the first prompt\n- Try the second prompt\n-->',
          { isStreaming: true },
        ),
      ],
    });
    appStore.dispatch(streamActivityReceived(agentId, true));
    appStore.dispatch(updateSession(agentId, { lastAgentResponse: 'The prose answer.' }));

    render(AgentCard, { props: { agentId } });

    const preview = await screen.findByTestId('agent-card-preview');
    expect(preview.textContent).toContain('The prose answer.');
    expect(preview.textContent).not.toContain('Try the first prompt');
    expect(preview.textContent).not.toContain('Try the second prompt');
  });

  it('serves the wire lastAgentResponse verbatim when the agent is not responding', async () => {
    // Idle agent: the wire preview field is authoritative (the daemon updates
    // it at turn end via clean_response_text); the loaded transcript is never
    // consulted to re-derive the preview.
    seedSession({
      isStreaming: false,
      status: AgentStatus.Idle,
      messages: [assistantMessage('stale transcript text')],
    });
    appStore.dispatch(updateSession(agentId, { lastAgentResponse: 'wire final answer' }));

    render(AgentCard, { props: { agentId } });

    const preview = await screen.findByTestId('agent-card-preview');
    expect(preview.textContent).toContain('wire final answer');
    expect(preview.textContent).not.toContain('stale transcript text');
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

describe('AgentCard live tool preview (tool-only stretches)', () => {
  beforeEach(() => {
    appStore.init();
    agentId = `agent-preview-${++testAgentSeq}`;
  });

  afterEach(() => {
    appStore.dispatch(removeSession(agentId));
  });

  it('shows the push-applied lastToolUse instead of freezing on the previous turn text', async () => {
    // Tool-only window: the turn produced no text yet, so the transcript still
    // holds the last turn's answer — the live tool call is the fresher signal.
    seedSession({
      isStreaming: true,
      messages: [assistantMessage('stale persisted text from last turn')],
    });
    appStore.dispatch(updateSession(agentId, { lastToolUse: { name: 'read_file' } }));

    render(AgentCard, { props: { agentId } });

    const preview = await screen.findByTestId('agent-card-preview');
    expect(preview.textContent).not.toContain('stale persisted text');
    await waitFor(() => expect(preview.textContent?.toLowerCase()).toContain('read'));
  });

  it('lets push-applied live text outrank the live tool label', async () => {
    seedSession({
      isStreaming: true,
      messages: [],
    });
    appStore.dispatch(streamActivityReceived(agentId, true));
    appStore.dispatch(
      updateSession(agentId, {
        lastAgentResponse: 'push-applied live text',
        lastToolUse: { name: 'read_file' },
      }),
    );

    render(AgentCard, { props: { agentId } });

    const preview = await screen.findByTestId('agent-card-preview');
    expect(preview.textContent).toContain('push-applied live text');
  });

  it('outranks the previous-turn digest while responding', async () => {
    seedSession({
      isStreaming: true,
      messages: [assistantMessage('stale persisted text')],
    });
    appStore.dispatch(
      updateSession(agentId, {
        digest: 'Parser rewrite in progress',
        lastToolUse: { name: 'read_file' },
      }),
    );

    render(AgentCard, { props: { agentId } });

    const preview = await screen.findByTestId('agent-card-preview');
    expect(preview.textContent?.toLowerCase()).toContain('read');
    expect(screen.queryByText('Parser rewrite in progress')).toBeNull();
  });

  it('keeps the wire response preview over a leftover lastToolUse once idle', async () => {
    // Idle agent: response text keeps precedence — a persisted lastToolUse
    // only drives the preview when there is no response text.
    seedSession({
      isStreaming: false,
      status: AgentStatus.Idle,
      messages: [],
      lastAgentResponse: 'final persisted answer',
    });
    appStore.dispatch(updateSession(agentId, { lastToolUse: { name: 'read_file' } }));

    render(AgentCard, { props: { agentId } });

    const preview = await screen.findByTestId('agent-card-preview');
    expect(preview.textContent).toContain('final persisted answer');
  });

  it('degrades to the existing preview when the daemon sends no lastToolUse', async () => {
    seedSession({
      isStreaming: true,
      messages: [],
      lastAgentResponse: 'stale persisted text from last turn',
    });

    render(AgentCard, { props: { agentId } });

    const preview = await screen.findByTestId('agent-card-preview');
    expect(preview.textContent).toContain('stale persisted text from last turn');
  });

  it('outranks the newest-user-message line while the tool call is in flight', async () => {
    // In-turn tool call with the user's message still newest in the
    // transcript: the tool is the newer signal, so it wins the preview.
    seedSession({
      isStreaming: true,
      messages: [],
      lastUserMessage: 'just sent this',
      lastMessageRole: 'user',
    });
    appStore.dispatch(updateSession(agentId, { lastToolUse: { name: 'read_file' } }));

    render(AgentCard, { props: { agentId } });

    const preview = await screen.findByTestId('agent-card-preview');
    expect(preview.textContent?.toLowerCase()).toContain('read');
    expect(preview.textContent).not.toContain('just sent this');
  });

  it('falls back to the user line when the tool name has no renderable label', async () => {
    // `workspace_api` without a streamed summary classifies as hidden, so
    // AgentPreviewToolLabel renders nothing — it must not suppress the user
    // line and leave the row blank.
    seedSession({
      isStreaming: true,
      messages: [],
      lastUserMessage: 'just sent this',
      lastMessageRole: 'user',
    });
    appStore.dispatch(updateSession(agentId, { lastToolUse: { name: 'workspace_api' } }));

    render(AgentCard, { props: { agentId } });

    const preview = await screen.findByTestId('agent-card-preview');
    expect(preview.textContent).toContain('just sent this');
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

  it('renders no preview from the transcript when the wire fields are absent (no fallback)', async () => {
    // Decision (monorepo#2843): no transcript fallback — absent wire preview
    // fields yield an empty preview even when the loaded transcript has
    // messages, so the FE never re-derives what the daemon already cleans.
    seedSession({
      status: AgentStatus.Idle,
      isStreaming: false,
      messages: [
        assistantMessage('previous assistant answer'),
        userMessage('new user question\nwith a second line'),
      ],
    });

    render(AgentCard, { props: { agentId } });

    await screen.findByText('Watched Agent');
    expect(screen.queryByTestId('agent-card-preview')).toBeNull();
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
      lastUserMessage: 'the question',
      lastAgentResponse: 'the final answer',
      lastMessageRole: 'assistant',
    });

    render(AgentCard, { props: { agentId } });

    const preview = await screen.findByTestId('agent-card-preview');
    expect(preview.textContent).toContain('the final answer');
    expect(preview.textContent).not.toContain('the question');
  });

  it('previews the wire lastUserMessage on an AgentLite-only session without lastMessageRole (older daemon)', async () => {
    // Absent role (older daemon) the freshness-wins precedence stays
    // disabled, but the peek-utils wire fallback still surfaces the user
    // text through the lowest-precedence preview slot — strictly better
    // than an empty card. A wire lastAgentResponse would outrank it there.
    seedSession({
      status: AgentStatus.Idle,
      isStreaming: false,
      messages: [],
      lastUserMessage: 'wire-only user text',
    });

    render(AgentCard, { props: { agentId } });

    const preview = await screen.findByTestId('agent-card-preview');
    expect(preview.textContent).toContain('wire-only user text');
  });

  it('lets the wire lastAgentResponse outrank the wire lastUserMessage when the role is absent', async () => {
    seedSession({
      status: AgentStatus.Idle,
      isStreaming: false,
      messages: [],
      lastUserMessage: 'wire-only user text',
      lastAgentResponse: 'wire-only response text',
    });

    render(AgentCard, { props: { agentId } });

    const preview = await screen.findByTestId('agent-card-preview');
    expect(preview.textContent).toContain('wire-only response text');
    expect(preview.textContent).not.toContain('wire-only user text');
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
    // chain falls through to the wire lastToolUse preview instead (transcript
    // tool_use blocks are never consulted).
    seedSession({
      isStreaming: true,
      messages: [assistantMessage('wrapped up <agent_digest>old transcript digest</agent_digest>')],
      metadata: { completionReport: 'report from the last turn' } as AgentSession['metadata'],
    });
    appStore.dispatch(updateSession(agentId, { lastToolUse: { name: 'read_file' } }));

    render(AgentCard, {
      props: { agentId, lastResponseSummary: 'summary from the last turn' },
    });

    // Pin the preview to the tool label (classifyTool verb for the wire
    // lastToolUse) so a regression to lastResponse/lastUserMsg cannot pass.
    const preview = await screen.findByTestId('agent-card-preview');
    expect(preview.textContent?.toLowerCase()).toContain('read');
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

/**
 * Pending Agent Q&A derivation (wire contract): questions on the LAST
 * assistant message with NO later user message are pending; ANY later user
 * message supersedes them; streaming/running turns never pend. Because the
 * derivation reads only the transcript, restored sessions re-surface
 * unanswered questions automatically — covered explicitly below.
 */
import { describe, expect, it } from 'vitest';
import { derivePendingQuestions } from '../pending-questions';
import { QUESTION_RESOURCE_MIME_TYPE } from '$shared/types/question-resource';
import type { AgentMessage, AgentSession, ContentBlock } from '$shared/types';
import type { StoreState } from '$store/renderer/types';
import {
  selectAgentIsResponding,
  selectAgentIsRunning,
} from '$store/renderer/slices/agent-session/agent-session-selectors';

const QUESTION = {
  attachmentId: 'tar-abc123def456',
  header: 'Auth method',
  question: 'Which authentication method should the new endpoint use?',
  options: [
    { label: 'OAuth', description: 'Standard OAuth 2.0 flow' },
    { label: 'API key', description: 'Static key in header' },
  ],
  multiSelect: false,
};

function questionBlock(overrides: Partial<typeof QUESTION> = {}): ContentBlock {
  const q = { ...QUESTION, ...overrides };
  return {
    type: 'resource',
    resource: {
      uri: `intent-question://${q.attachmentId}`,
      name: q.header,
      mimeType: QUESTION_RESOURCE_MIME_TYPE,
      text: JSON.stringify(q),
    },
  } as unknown as ContentBlock;
}

function assistantMessage(
  blocks: ContentBlock[],
  overrides: Partial<AgentMessage> = {},
): AgentMessage {
  return {
    id: overrides.id ?? 'msg-assistant-1',
    role: 'assistant',
    contentBlocks: blocks,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function userMessage(id = 'msg-user-1'): AgentMessage {
  return {
    id,
    role: 'user',
    contentBlocks: [{ type: 'text', text: 'a reply' }],
    timestamp: new Date().toISOString(),
  };
}

describe('derivePendingQuestions', () => {
  it('derives questions from the last assistant message', () => {
    const msg = assistantMessage([
      { type: 'text', text: 'Some context first.' },
      questionBlock(),
      questionBlock({ attachmentId: 'tar-bbb222ccc333', header: 'Scope' }),
    ]);
    const pending = derivePendingQuestions([msg], false);
    expect(pending).not.toBeNull();
    expect(pending!.messageId).toBe('msg-assistant-1');
    expect(pending!.questions.map((q) => q.header)).toEqual(['Auth method', 'Scope']);
  });

  it('returns null while the agent is running', () => {
    const msg = assistantMessage([questionBlock()]);
    expect(derivePendingQuestions([msg], true)).toBeNull();
  });

  it('returns null while the last assistant message is streaming', () => {
    const msg = assistantMessage([questionBlock()], { isStreaming: true });
    expect(derivePendingQuestions([msg], false)).toBeNull();
  });

  it('returns null when ANY later user message supersedes the questions', () => {
    const msg = assistantMessage([questionBlock()]);
    expect(derivePendingQuestions([msg, userMessage()], false)).toBeNull();
  });

  it('returns null when an optimistic pending user bubble is shown', () => {
    const msg = assistantMessage([questionBlock()]);
    expect(derivePendingQuestions([msg], false, true)).toBeNull();
  });

  it('returns null when the last assistant message has no question blocks', () => {
    const msg = assistantMessage([{ type: 'text', text: 'No questions here.' }]);
    expect(derivePendingQuestions([msg], false)).toBeNull();
    expect(derivePendingQuestions([], false)).toBeNull();
  });

  it('ignores questions on earlier assistant messages', () => {
    const earlier = assistantMessage([questionBlock()], { id: 'msg-a1' });
    const later = assistantMessage([{ type: 'text', text: 'Done.' }], { id: 'msg-a2' });
    expect(derivePendingQuestions([earlier, userMessage(), later], false)).toBeNull();
  });

  it('collapses duplicate resource blocks to one question', () => {
    const msg = assistantMessage([questionBlock(), questionBlock()]);
    const pending = derivePendingQuestions([msg], false);
    expect(pending!.questions).toHaveLength(1);
  });

  it('re-surfaces unanswered questions on session restore (transcript-only derivation)', () => {
    // A restored session replays the same transcript: user asked, assistant
    // answered with trailing question blocks, no later user message. The
    // derivation must pend again with no persisted state involved.
    const restored: AgentMessage[] = [
      userMessage('msg-u0'),
      assistantMessage([{ type: 'text', text: 'Before I proceed:' }, questionBlock()], {
        id: 'msg-a1',
      }),
    ];
    const pending = derivePendingQuestions(restored, false);
    expect(pending).not.toBeNull();
    expect(pending!.messageId).toBe('msg-a1');
    expect(pending!.questions[0].header).toBe('Auth method');
  });
});

// ============================================================================
// Wizard gate — waiting on delegated agents (regression)
// ============================================================================

function makeStoredSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 'agent-coordinator' as AgentSession['id'],
    backendSessionId: null,
    workspaceId: 'ws-1' as AgentSession['workspaceId'],
    name: 'Coordinator',
    status: 'idle' as AgentSession['status'],
    messages: [],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function stateWith(session: AgentSession): StoreState {
  return {
    agentSessions: { byAgentId: { [session.id]: session }, agentIdsByWorkspace: {} },
  } as unknown as StoreState;
}

/**
 * Mirrors ChatPanel.svelte's `pendingQuestions` derivation: the gate fed into
 * `derivePendingQuestions` is the agent's OWN active turn
 * (`selectAgentIsResponding`), NOT the broad `selectAgentIsRunning` gate —
 * `isRunning` stays true while the agent merely waits on delegated agents,
 * which must not suppress the wizard.
 */
function deriveWizardPendingQuestions(
  state: StoreState,
  agentId: string,
  messages: AgentMessage[],
  showingPendingUserMessage = false,
) {
  const isResponding = selectAgentIsResponding.select(state, agentId);
  return derivePendingQuestions(messages, isResponding, showingPendingUserMessage);
}

describe('wizard gate while waiting on delegated agents', () => {
  const AGENT_ID = 'agent-coordinator';
  // Coordinator asked a question, ended its own turn, and is now paused on
  // delegated agents (daemon-owned isWaitingForOtherAgents flag).
  const waitingSession = makeStoredSession({
    isResponding: false,
    isStreaming: false,
    isProcessing: false,
    isWaitingForOtherAgents: true,
  });
  const transcript: AgentMessage[] = [
    userMessage('msg-u0'),
    assistantMessage([{ type: 'text', text: 'Delegating; one question:' }, questionBlock()], {
      id: 'msg-a1',
    }),
  ];

  it('REGRESSION: questions pend while the agent only waits on other agents (own turn ended)', () => {
    const state = stateWith(waitingSession);
    // Sanity: the broad running gate is true here — gating the wizard on it
    // is exactly the bug (the wizard never mounted during the waiting window).
    expect(selectAgentIsRunning.select(state, AGENT_ID)).toBe(true);
    const pending = deriveWizardPendingQuestions(state, AGENT_ID, transcript);
    expect(pending).not.toBeNull();
    expect(pending!.messageId).toBe('msg-a1');
    expect(pending!.questions[0].header).toBe('Auth method');
  });

  it('still suppresses the wizard while the agent own turn is active (responding)', () => {
    const state = stateWith(makeStoredSession({ isResponding: true }));
    expect(deriveWizardPendingQuestions(state, AGENT_ID, transcript)).toBeNull();
  });

  it('still suppresses the wizard while the agent own turn is streaming', () => {
    const state = stateWith(makeStoredSession({ isStreaming: true }));
    expect(deriveWizardPendingQuestions(state, AGENT_ID, transcript)).toBeNull();
  });

  it('a trailing user message (e.g. delegated-agent wake report) still supersedes', () => {
    const state = stateWith(waitingSession);
    const superseded = [...transcript, userMessage('msg-wake-report')];
    expect(deriveWizardPendingQuestions(state, AGENT_ID, superseded)).toBeNull();
  });

  it('an optimistic pending user bubble still suppresses the wizard', () => {
    const state = stateWith(waitingSession);
    expect(deriveWizardPendingQuestions(state, AGENT_ID, transcript, true)).toBeNull();
  });
});

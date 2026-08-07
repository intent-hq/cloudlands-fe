/**
 * Pending Agent Q&A derivation (wire contract): the NEWEST question-bearing
 * assistant message pends PERSISTENTLY — across later plain user messages and
 * the agent's subsequent replies — until a later user row carries the
 * matching `question_answers` metadata tag, the dismissal marker matches
 * (wizard gate), or a newer question set supersedes it. Streaming/running
 * turns never pend. Because the derivation reads only the transcript,
 * restored sessions re-surface unanswered questions automatically — covered
 * explicitly below.
 */
import { describe, expect, it } from 'vitest';
import { derivePendingQuestions } from '../pending-questions';
import { buildAnswerMessageMetadata } from '../answer-message';
import { deriveWizardPendingQuestions } from '../wizard-gate';
import { QUESTION_RESOURCE_MIME_TYPE } from '$shared/types/question-resource';
import type { AgentMessage, AgentSession, ContentBlock } from '$shared/types';
import type { StoreState } from '$store/renderer/types';
import { selectAgentIsRunning } from '$store/renderer/slices/agent-session/agent-session-selectors';

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

/** The wizard's answer message: tagged with the answered question set's id. */
function answerMessage(answeredQuestionsMessageId: string, id = 'msg-answer-1'): AgentMessage {
  return {
    id,
    role: 'user',
    contentBlocks: [{ type: 'text', text: 'Q: Auth method\nA: OAuth' }],
    timestamp: new Date().toISOString(),
    metadata: buildAnswerMessageMetadata(answeredQuestionsMessageId),
  } as unknown as AgentMessage;
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

  it('keeps pending across a later PLAIN user message (persistent contract)', () => {
    const msg = assistantMessage([questionBlock()]);
    const pending = derivePendingQuestions([msg, userMessage()], false);
    expect(pending).not.toBeNull();
    expect(pending!.messageId).toBe('msg-assistant-1');
  });

  it("keeps pending across the agent's later reply to a plain user message", () => {
    const msg = assistantMessage([questionBlock()]);
    const later = [
      msg,
      userMessage('msg-u1'),
      assistantMessage([{ type: 'text', text: 'Sure, doing that.' }], { id: 'msg-a2' }),
    ];
    const pending = derivePendingQuestions(later, false);
    expect(pending).not.toBeNull();
    expect(pending!.messageId).toBe('msg-assistant-1');
  });

  it('resolves only on a later user row tagged with the matching answered id', () => {
    const msg = assistantMessage([questionBlock()]);
    expect(derivePendingQuestions([msg, answerMessage('msg-assistant-1')], false)).toBeNull();
    // A tag naming a DIFFERENT question set leaves this one pending.
    expect(derivePendingQuestions([msg, answerMessage('msg-other')], false)).not.toBeNull();
  });

  it('a newer question-bearing assistant message supersedes the older set', () => {
    const older = assistantMessage([questionBlock()], { id: 'msg-a1' });
    const newer = assistantMessage([questionBlock({ header: 'Second round' })], { id: 'msg-a2' });
    const pending = derivePendingQuestions([older, userMessage('msg-u1'), newer], false);
    expect(pending).not.toBeNull();
    expect(pending!.messageId).toBe('msg-a2');
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

  it('a question-less later assistant message does not resolve the older set', () => {
    const earlier = assistantMessage([questionBlock()], { id: 'msg-a1' });
    const later = assistantMessage([{ type: 'text', text: 'Done.' }], { id: 'msg-a2' });
    const pending = derivePendingQuestions([earlier, userMessage(), later], false);
    expect(pending).not.toBeNull();
    expect(pending!.messageId).toBe('msg-a1');
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

// The suite exercises the REAL production gate — deriveWizardPendingQuestions
// from ../wizard-gate, the same function ChatPanel.svelte calls — so reverting
// the gate to the broad running selector fails the regression test below.
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

  it('a trailing user message (e.g. delegated-agent wake report) no longer supersedes', () => {
    const state = stateWith(waitingSession);
    const withWake = [...transcript, userMessage('msg-wake-report')];
    const pending = deriveWizardPendingQuestions(state, AGENT_ID, withWake);
    expect(pending).not.toBeNull();
    expect(pending!.messageId).toBe('msg-a1');
  });

  it('the wizard answer message (tagged) resolves the set', () => {
    const state = stateWith(waitingSession);
    const answered = [...transcript, answerMessage('msg-a1')];
    expect(deriveWizardPendingQuestions(state, AGENT_ID, answered)).toBeNull();
  });

  it('an optimistic pending user bubble still suppresses the wizard', () => {
    const state = stateWith(waitingSession);
    expect(deriveWizardPendingQuestions(state, AGENT_ID, transcript, true)).toBeNull();
  });
});

// ============================================================================
// Wizard gate — daemon-persisted question dismissal (agent.dismissQuestions)
// ============================================================================

describe('wizard gate honors the persisted dismissal marker', () => {
  const AGENT_ID = 'agent-coordinator';
  const idleSession = makeStoredSession({
    isResponding: false,
    isStreaming: false,
    isProcessing: false,
  });
  const transcript: AgentMessage[] = [
    userMessage('msg-u0'),
    assistantMessage([{ type: 'text', text: 'One question:' }, questionBlock()], {
      id: 'msg-a1',
    }),
  ];

  it('suppresses the wizard when metadata.dismissedQuestionsMessageId matches the pending message', () => {
    // The marker is persisted by the daemon (`agent.dismissQuestions`,
    // PROTOCOL §5.5) and rehydrated into session metadata — so the
    // suppression survives reload/rehydrate by construction: the gate reads
    // only rehydrated state, no transient component flag.
    const state = stateWith(
      makeStoredSession({
        ...idleSession,
        metadata: { dismissedQuestionsMessageId: 'msg-a1' },
      }),
    );
    expect(deriveWizardPendingQuestions(state, AGENT_ID, transcript)).toBeNull();
  });

  it('a NEWER question-bearing message (different id) pends despite an older dismissal', () => {
    const state = stateWith(
      makeStoredSession({
        ...idleSession,
        metadata: { dismissedQuestionsMessageId: 'msg-a1' },
      }),
    );
    const newer = [
      ...transcript,
      userMessage('msg-u1'),
      assistantMessage([questionBlock({ header: 'Second round' })], { id: 'msg-a2' }),
    ];
    const pending = deriveWizardPendingQuestions(state, AGENT_ID, newer);
    expect(pending).not.toBeNull();
    expect(pending!.messageId).toBe('msg-a2');
  });

  it('no dismissal marker → questions pend normally', () => {
    const state = stateWith(idleSession);
    const pending = deriveWizardPendingQuestions(state, AGENT_ID, transcript);
    expect(pending).not.toBeNull();
    expect(pending!.messageId).toBe('msg-a1');
  });

  it('a non-matching dismissal marker does not suppress', () => {
    const state = stateWith(
      makeStoredSession({
        ...idleSession,
        metadata: { dismissedQuestionsMessageId: 'msg-other' },
      }),
    );
    const pending = deriveWizardPendingQuestions(state, AGENT_ID, transcript);
    expect(pending).not.toBeNull();
    expect(pending!.messageId).toBe('msg-a1');
  });
});

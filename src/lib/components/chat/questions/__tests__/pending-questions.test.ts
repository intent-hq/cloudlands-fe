/**
 * Pending Agent Q&A derivation (wire contract): a present daemon marker is
 * authoritative and persistent. When an old daemon omits the marker, the FE
 * matches its transcript-tail fallback: trailing system rows are transparent,
 * and only a question-bearing assistant row at the non-system tail pends.
 */
import { describe, expect, it } from 'vitest';
import { classifyPendingQuestionMarker, derivePendingQuestions } from '../pending-questions';
import { buildAnswerMessageMetadata, getAnsweredQuestionsMessageId } from '../answer-message';
import { deriveMarkedQuestionRecoveryState, deriveWizardPendingQuestions } from '../wizard-gate';
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

function systemMessage(id = 'msg-system-1'): AgentMessage {
  return {
    id,
    role: 'system',
    contentBlocks: [{ type: 'text', text: 'interruption notice' }],
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

describe('classifyPendingQuestionMarker', () => {
  it('keeps absent, written-empty, and set markers distinct', () => {
    expect(classifyPendingQuestionMarker(undefined)).toEqual({ kind: 'absent' });
    expect(classifyPendingQuestionMarker('')).toEqual({ kind: 'cleared' });
    expect(classifyPendingQuestionMarker('msg-question')).toEqual({
      kind: 'set',
      messageId: 'msg-question',
    });
  });
});

describe('getAnsweredQuestionsMessageId', () => {
  it('reads the row metadata tag', () => {
    expect(getAnsweredQuestionsMessageId(answerMessage('msg-a1'))).toBe('msg-a1');
    expect(getAnsweredQuestionsMessageId(userMessage())).toBeNull();
    expect(getAnsweredQuestionsMessageId(undefined)).toBeNull();
  });

  it('falls back to a text block messageMetadata tag when the row is untagged', () => {
    const blockTagged = {
      id: 'msg-answer-block',
      role: 'user',
      contentBlocks: [
        {
          type: 'text',
          text: 'Q: Auth method\nA: OAuth',
          messageMetadata: buildAnswerMessageMetadata('msg-a1'),
        },
      ],
      timestamp: new Date().toISOString(),
    } as unknown as AgentMessage;
    expect(getAnsweredQuestionsMessageId(blockTagged)).toBe('msg-a1');

    const emptyId = {
      id: 'msg-answer-empty',
      role: 'user',
      contentBlocks: [
        {
          type: 'text',
          text: 'Q: Auth method\nA: OAuth',
          messageMetadata: { type: 'question_answers', answeredQuestionsMessageId: '' },
        },
      ],
      timestamp: new Date().toISOString(),
    } as unknown as AgentMessage;
    expect(getAnsweredQuestionsMessageId(emptyId)).toBeNull();
  });
});

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

  it('returns null while the agent is running (legacy fallback, no marker)', () => {
    const msg = assistantMessage([questionBlock()]);
    expect(derivePendingQuestions([msg], true)).toBeNull();
  });

  it('keeps a marked set pending while a later turn is running', () => {
    const msg = assistantMessage([questionBlock()], { id: 'msg-a1' });
    const transcript = [msg, userMessage('msg-u1')];
    expect(derivePendingQuestions(transcript, true, false, 'msg-a1')).toMatchObject({
      messageId: 'msg-a1',
    });
    const withStreamingReply = [
      ...transcript,
      assistantMessage([{ type: 'text', text: 'Working…' }], { id: 'msg-a2', isStreaming: true }),
    ];
    expect(derivePendingQuestions(withStreamingReply, true, false, 'msg-a1')).toMatchObject({
      messageId: 'msg-a1',
    });
  });

  it('returns null while the last assistant message is streaming', () => {
    const msg = assistantMessage([questionBlock()], { isStreaming: true });
    expect(derivePendingQuestions([msg], false)).toBeNull();
  });

  it('returns null while the MARKED message itself is still streaming', () => {
    const msg = assistantMessage([questionBlock()], { id: 'msg-a1', isStreaming: true });
    expect(derivePendingQuestions([msg], true, false, 'msg-a1')).toBeNull();
    expect(derivePendingQuestions([msg], false, false, 'msg-a1')).toBeNull();
  });

  it('a tagged answer row hides a marked set before the daemon clears the marker', () => {
    // The optimistic answer row mirrors the wire tag; the marker is still set
    // until agent:updated lands, and the next turn is already active.
    const msg = assistantMessage([questionBlock()], { id: 'msg-a1' });
    const answered = [msg, answerMessage('msg-a1')];
    expect(derivePendingQuestions(answered, true, false, 'msg-a1')).toBeNull();
    expect(derivePendingQuestions(answered, false, false, 'msg-a1')).toBeNull();
    // An answer for a different set does not resolve this one.
    const otherAnswer = [msg, answerMessage('msg-other')];
    expect(derivePendingQuestions(otherAnswer, false, false, 'msg-a1')).toMatchObject({
      messageId: 'msg-a1',
    });
  });

  it('ends the legacy fallback at a later user row', () => {
    const msg = assistantMessage([questionBlock()]);
    expect(derivePendingQuestions([msg, userMessage()], false)).toBeNull();
  });

  it("ends the legacy fallback at the agent's later question-free reply", () => {
    const msg = assistantMessage([questionBlock()]);
    const later = [
      msg,
      userMessage('msg-u1'),
      assistantMessage([{ type: 'text', text: 'Sure, doing that.' }], { id: 'msg-a2' }),
    ];
    expect(derivePendingQuestions(later, false)).toBeNull();
  });

  it('ends the legacy fallback at any later user row', () => {
    const msg = assistantMessage([questionBlock()]);
    expect(derivePendingQuestions([msg, answerMessage('msg-assistant-1')], false)).toBeNull();
    expect(derivePendingQuestions([msg, answerMessage('msg-other')], false)).toBeNull();
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

  it('a question-less later assistant message ends the legacy fallback', () => {
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

  it('supports old-daemon payloads with the exact non-system tail fallback', () => {
    const msg = assistantMessage([questionBlock()], { id: 'msg-a1' });
    expect(derivePendingQuestions([msg, systemMessage()], false, false, undefined)).toMatchObject({
      messageId: 'msg-a1',
    });
    expect(
      derivePendingQuestions(
        [msg, systemMessage(), userMessage('msg-u1')],
        false,
        false,
        undefined,
      ),
    ).toBeNull();
    expect(
      derivePendingQuestions(
        [msg, systemMessage(), assistantMessage([{ type: 'text', text: 'Later reply.' }])],
        false,
        false,
        undefined,
      ),
    ).toBeNull();
  });

  it('an authoritative empty marker suppresses an old question after later messages', () => {
    const transcript = [
      assistantMessage([questionBlock()], { id: 'msg-a1' }),
      userMessage('msg-u1'),
      assistantMessage([{ type: 'text', text: 'First follow-up.' }], { id: 'msg-a2' }),
      userMessage('msg-u2'),
      assistantMessage([{ type: 'text', text: 'Second follow-up.' }], { id: 'msg-a3' }),
    ];
    expect(derivePendingQuestions(transcript, false, false, '')).toBeNull();
  });

  it('a non-empty marker permits only its matching question-bearing message', () => {
    const older = assistantMessage([questionBlock()], { id: 'msg-a1' });
    const newer = assistantMessage([questionBlock({ header: 'Second round' })], { id: 'msg-a2' });
    expect(derivePendingQuestions([older, newer], false, false, 'msg-a1')).toMatchObject({
      messageId: 'msg-a1',
    });
    expect(derivePendingQuestions([older, newer], false, false, 'msg-missing')).toBeNull();
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
    metadata: { pendingQuestionsMessageId: 'msg-a1' },
  });
  const transcript: AgentMessage[] = [
    userMessage('msg-u0'),
    assistantMessage([{ type: 'text', text: 'Delegating; one question:' }, questionBlock()], {
      id: 'msg-a1',
    }),
  ];

  it('REGRESSION: questions pend while the agent only waits on other agents (own turn ended)', () => {
    const state = stateWith(waitingSession);
    // A settled peer wait is blocked waiting, not active work. The wizard must
    // remain available throughout this waiting window.
    expect(selectAgentIsRunning.select(state, AGENT_ID)).toBe(false);
    const pending = deriveWizardPendingQuestions(state, AGENT_ID, transcript);
    expect(pending).not.toBeNull();
    expect(pending!.messageId).toBe('msg-a1');
    expect(pending!.questions[0].header).toBe('Auth method');
  });

  it('legacy (marker-less) sessions still suppress the wizard while the own turn is active', () => {
    expect(
      deriveWizardPendingQuestions(
        stateWith(makeStoredSession({ isResponding: true })),
        AGENT_ID,
        transcript,
      ),
    ).toBeNull();
    expect(
      deriveWizardPendingQuestions(
        stateWith(makeStoredSession({ isStreaming: true })),
        AGENT_ID,
        transcript,
      ),
    ).toBeNull();
  });

  it('STICKY: a marked set stays visible while a later automatic/user turn runs', () => {
    const runningLater = makeStoredSession({
      isResponding: true,
      isStreaming: true,
      metadata: { pendingQuestionsMessageId: 'msg-a1' },
    });
    const state = stateWith(runningLater);
    const laterTurn = [
      ...transcript,
      userMessage('msg-wake-report'),
      assistantMessage([{ type: 'text', text: 'Handling the report…' }], {
        id: 'msg-a2',
        isStreaming: true,
      }),
    ];
    expect(deriveWizardPendingQuestions(state, AGENT_ID, laterTurn)).toMatchObject({
      messageId: 'msg-a1',
    });
  });

  it('STICKY: the marked message still streaming (asking turn in flight) suppresses the wizard', () => {
    const state = stateWith(
      makeStoredSession({
        isResponding: true,
        isStreaming: true,
        metadata: { pendingQuestionsMessageId: 'msg-a1' },
      }),
    );
    const asking = [
      transcript[0],
      assistantMessage([questionBlock()], { id: 'msg-a1', isStreaming: true }),
    ];
    expect(deriveWizardPendingQuestions(state, AGENT_ID, asking)).toBeNull();
  });

  it('STICKY: the optimistic tagged answer row hides the wizard before the marker clears', () => {
    // Send flips the own-turn gate on and appends the tagged optimistic row;
    // the daemon's written clear (agent:updated) lands later.
    const state = stateWith(
      makeStoredSession({
        isResponding: true,
        isStreaming: true,
        metadata: { pendingQuestionsMessageId: 'msg-a1' },
      }),
    );
    const answered = [...transcript, answerMessage('msg-a1')];
    expect(deriveWizardPendingQuestions(state, AGENT_ID, answered)).toBeNull();
  });

  it('a trailing user message (e.g. delegated-agent wake report) no longer supersedes', () => {
    const state = stateWith(waitingSession);
    const withWake = [...transcript, userMessage('msg-wake-report')];
    const pending = deriveWizardPendingQuestions(state, AGENT_ID, withWake);
    expect(pending).not.toBeNull();
    expect(pending!.messageId).toBe('msg-a1');
  });

  it('the wizard answer message (tagged) resolves the set', () => {
    const state = stateWith(
      makeStoredSession({
        ...waitingSession,
        metadata: { pendingQuestionsMessageId: '' },
      }),
    );
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

describe('wizard gate honors the authoritative pending marker', () => {
  const AGENT_ID = 'agent-coordinator';
  const transcript: AgentMessage[] = [
    assistantMessage([questionBlock()], { id: 'msg-a1' }),
    userMessage('msg-u1'),
    assistantMessage([{ type: 'text', text: 'Later reply.' }], { id: 'msg-a2' }),
  ];

  it('uses the legacy tail rule for an old-daemon AgentLite without the marker field', () => {
    const state = stateWith(makeStoredSession({ metadata: {} }));
    const questionTail = [
      assistantMessage([questionBlock()], { id: 'msg-old-daemon-question' }),
      systemMessage(),
    ];
    expect(deriveWizardPendingQuestions(state, AGENT_ID, questionTail)).toMatchObject({
      messageId: 'msg-old-daemon-question',
    });
    expect(
      deriveWizardPendingQuestions(state, AGENT_ID, [...questionTail, userMessage('msg-u1')]),
    ).toBeNull();
  });

  it('keeps an answered question hidden after rehydration with a written empty marker', () => {
    // The rehydrated transcript window no longer contains the older tagged
    // answer row. The written empty marker must still prevent resurrection.
    const rehydrated = stateWith(
      makeStoredSession({ metadata: { pendingQuestionsMessageId: '' } }),
    );
    expect(deriveWizardPendingQuestions(rehydrated, AGENT_ID, transcript)).toBeNull();
  });

  it('keeps a non-empty marker authoritative across later non-system rows', () => {
    const state = stateWith(
      makeStoredSession({ metadata: { pendingQuestionsMessageId: 'msg-a1' } }),
    );
    expect(deriveWizardPendingQuestions(state, AGENT_ID, transcript)).toMatchObject({
      messageId: 'msg-a1',
    });
  });

  it('shows a newer marked question after an older set was cleared', () => {
    const newerTranscript = [
      ...transcript,
      assistantMessage([questionBlock({ header: 'Second round' })], { id: 'msg-a3' }),
    ];
    const state = stateWith(
      makeStoredSession({ metadata: { pendingQuestionsMessageId: 'msg-a3' } }),
    );
    expect(deriveWizardPendingQuestions(state, AGENT_ID, newerTranscript)).toMatchObject({
      messageId: 'msg-a3',
    });
  });

  it('finds an older marked question in the canonical paged history segment', () => {
    const marked = assistantMessage([questionBlock()], { id: 'msg-old-question' });
    const state = stateWith(
      makeStoredSession({
        messages: transcript,
        metadata: { pendingQuestionsMessageId: marked.id },
      }),
    );
    state.agentSessions.historySegmentsByAgentId = {
      [AGENT_ID]: { messages: [marked], gapToTail: true, oldestReached: false },
    };
    expect(deriveWizardPendingQuestions(state, AGENT_ID, transcript)).toMatchObject({
      messageId: marked.id,
    });
    expect(deriveMarkedQuestionRecoveryState(state, AGENT_ID)).toBeNull();

    // Sticky across a running later turn; resolved by a tagged tail row.
    state.agentSessions.byAgentId[AGENT_ID] = makeStoredSession({
      messages: transcript,
      isResponding: true,
      metadata: { pendingQuestionsMessageId: marked.id },
    });
    expect(deriveWizardPendingQuestions(state, AGENT_ID, transcript)).toMatchObject({
      messageId: marked.id,
    });
    expect(
      deriveWizardPendingQuestions(state, AGENT_ID, [...transcript, answerMessage(marked.id)]),
    ).toBeNull();
  });

  it('resolves a history-only marked set from a tagged answer in a question-free tail', () => {
    // The marked row lives only in the paged segment; the live tail carries
    // no question-bearing row of its own.
    const marked = assistantMessage([questionBlock()], { id: 'msg-old-question' });
    const unanswered = [userMessage('msg-u9')];
    const state = stateWith(
      makeStoredSession({
        messages: unanswered,
        isResponding: true,
        metadata: { pendingQuestionsMessageId: marked.id },
      }),
    );
    state.agentSessions.historySegmentsByAgentId = {
      [AGENT_ID]: { messages: [marked], gapToTail: true, oldestReached: false },
    };
    expect(deriveWizardPendingQuestions(state, AGENT_ID, unanswered)).toMatchObject({
      messageId: marked.id,
    });
    expect(
      deriveWizardPendingQuestions(state, AGENT_ID, [...unanswered, answerMessage(marked.id)]),
    ).toBeNull();
    expect(
      deriveWizardPendingQuestions(state, AGENT_ID, [...unanswered, answerMessage('msg-other')]),
    ).toMatchObject({ messageId: marked.id });
  });

  it('keeps a recovered marked set visible across later turns until answered', () => {
    const state = stateWith(
      makeStoredSession({
        isResponding: true,
        metadata: { pendingQuestionsMessageId: 'msg-recovered' },
      }),
    );
    state.chatState = {
      byAgentId: {
        [AGENT_ID]: {
          pendingQuestionRecovery: {
            messageId: 'msg-recovered',
            status: 'found',
            questions: [QUESTION],
          },
        },
      },
    } as StoreState['chatState'];
    expect(deriveWizardPendingQuestions(state, AGENT_ID, transcript)).toMatchObject({
      messageId: 'msg-recovered',
    });
    expect(
      deriveWizardPendingQuestions(state, AGENT_ID, [
        ...transcript,
        answerMessage('msg-recovered'),
      ]),
    ).toBeNull();
  });

  it('keeps an authoritative marker fail-closed when recovery settles as not found', () => {
    const state = stateWith(
      makeStoredSession({ metadata: { pendingQuestionsMessageId: 'msg-stale' } }),
    );
    expect(deriveMarkedQuestionRecoveryState(state, AGENT_ID)).toEqual({
      messageId: 'msg-stale',
      shouldRequest: true,
      loading: true,
    });
    state.chatState = {
      byAgentId: {
        [AGENT_ID]: {
          pendingQuestionRecovery: { messageId: 'msg-stale', status: 'not-found' },
        },
      },
    } as StoreState['chatState'];
    expect(deriveMarkedQuestionRecoveryState(state, AGENT_ID)).toEqual({
      messageId: 'msg-stale',
      shouldRequest: false,
      loading: true,
    });
  });

  it('keeps an exhausted current marker fail-closed until authoritative state changes', () => {
    const state = stateWith(
      makeStoredSession({ metadata: { pendingQuestionsMessageId: 'msg-unavailable' } }),
    );
    state.chatState = {
      byAgentId: {
        [AGENT_ID]: {
          pendingQuestionRecovery: { messageId: 'msg-unavailable', status: 'error' },
        },
      },
    } as StoreState['chatState'];

    expect(deriveMarkedQuestionRecoveryState(state, AGENT_ID)).toEqual({
      messageId: 'msg-unavailable',
      shouldRequest: false,
      loading: true,
    });

    state.agentSessions.byAgentId[AGENT_ID] = makeStoredSession({
      metadata: { pendingQuestionsMessageId: '' },
    });
    expect(deriveMarkedQuestionRecoveryState(state, AGENT_ID)).toBeNull();

    state.agentSessions.byAgentId[AGENT_ID] = makeStoredSession({
      metadata: { pendingQuestionsMessageId: 'msg-replacement' },
    });
    expect(deriveMarkedQuestionRecoveryState(state, AGENT_ID)).toEqual({
      messageId: 'msg-replacement',
      shouldRequest: true,
      loading: true,
    });

    delete state.agentSessions.byAgentId[AGENT_ID];
    expect(deriveMarkedQuestionRecoveryState(state, AGENT_ID)).toBeNull();
  });
});

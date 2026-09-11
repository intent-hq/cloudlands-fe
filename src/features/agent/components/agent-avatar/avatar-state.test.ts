import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentStatus, type AgentMessage } from '$shared/types';
import { QUESTION_RESOURCE_MIME_TYPE } from '$shared/types/question-resource';

const { getStateMock, selectAgentSessionMock, selectAgentIsRespondingMock } = vi.hoisted(() => ({
  getStateMock: vi.fn(() => ({ marker: 'state' })),
  selectAgentSessionMock: vi.fn(),
  selectAgentIsRespondingMock: vi.fn(),
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => getStateMock(),
  });
});

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentSession: {
    select: selectAgentSessionMock,
  },
  selectAgentIsResponding: {
    select: selectAgentIsRespondingMock,
  },
}));

import {
  AVATAR_STATE_PRECEDENCE,
  getAvatarState,
  getAvatarStateForSession,
  getAvatarStateFromStore,
  isAgentStreamingFromStore,
  type AgentStateInput,
  type AvatarState,
  type AvatarStateOptions,
} from './avatar-state';

describe('avatar-state store-backed selectors', () => {
  beforeEach(() => {
    getStateMock.mockClear();
    selectAgentSessionMock.mockReset();
    selectAgentIsRespondingMock.mockReset();
  });

  it('uses the canonical session fields for running state', () => {
    selectAgentSessionMock.mockReturnValue({
      id: 'agent-1',
      status: AgentStatus.Active,
      isResponding: true,
    });
    selectAgentIsRespondingMock.mockReturnValue(true);
    expect(getAvatarStateFromStore('ws-1', 'agent-1')).toBe('running');
  });

  it('lets active orchestration work take precedence over a peer-wait flag', () => {
    selectAgentSessionMock.mockReturnValue({
      id: 'agent-1',
      status: AgentStatus.Processing,
      isResponding: true,
      isWaitingForOtherAgents: true,
    });
    selectAgentIsRespondingMock.mockReturnValue(true);
    expect(getAvatarStateFromStore('ws-1', 'agent-1')).toBe('running');
  });

  it('renders a peer wait after its active turn ends', () => {
    selectAgentSessionMock.mockReturnValue({
      id: 'agent-1',
      status: AgentStatus.Idle,
      isResponding: false,
      isWaitingForOtherAgents: true,
    });
    expect(getAvatarStateFromStore('ws-1', 'agent-1')).toBe('waiting');
  });

  it('uses selectAgentIsResponding for store-backed streaming checks', () => {
    selectAgentIsRespondingMock.mockReturnValue(true);

    expect(isAgentStreamingFromStore('ws-1', 'agent-1')).toBe(true);
    expect(selectAgentIsRespondingMock).toHaveBeenCalledWith({ marker: 'state' }, 'agent-1');
  });
});

describe('getAvatarState attention-request states', () => {
  it('maps an unanswered question to question ahead of other non-failure states', () => {
    expect(
      getAvatarState(
        { isStreaming: true, status: AgentStatus.Active },
        { hasQuestion: true, attentionKind: 'discussion' },
      ),
    ).toBe('question');
    expect(getAvatarState({ status: AgentStatus.Error }, { hasQuestion: true })).toBe('failed');
  });

  it('maps a pending discussion request to attention-discussion', () => {
    expect(getAvatarState({ status: AgentStatus.Idle }, { attentionKind: 'discussion' })).toBe(
      'attention-discussion',
    );
  });

  it('maps a pending blocker request to attention-blocker', () => {
    expect(getAvatarState({ status: AgentStatus.Idle }, { attentionKind: 'blocker' })).toBe(
      'attention-blocker',
    );
  });

  it('lets completed/failed/needs-permission take precedence over attention', () => {
    expect(
      getAvatarState({ status: AgentStatus.Idle }, { attentionKind: 'blocker', isCompleted: true }),
    ).toBe('completed');
    expect(getAvatarState({ status: AgentStatus.Error }, { attentionKind: 'discussion' })).toBe(
      'failed',
    );
    expect(
      getAvatarState(
        { status: AgentStatus.Idle },
        { attentionKind: 'discussion', hasPermissionRequest: true },
      ),
    ).toBe('needs-permission');
  });

  it('lets attention take precedence over running/waiting', () => {
    expect(
      getAvatarState(
        { isStreaming: true, status: AgentStatus.Active },
        { attentionKind: 'blocker' },
      ),
    ).toBe('attention-blocker');
    expect(getAvatarState({ status: AgentStatus.Waiting }, { attentionKind: 'discussion' })).toBe(
      'attention-discussion',
    );
  });

  it('falls through unchanged when no attention request is pending', () => {
    expect(getAvatarState({ status: AgentStatus.Waiting }, { attentionKind: null })).toBe(
      'waiting',
    );
    expect(getAvatarState({ status: AgentStatus.Idle }, {})).toBe('idle');
  });
});

describe('getAvatarStateForSession attention running-vs-idle precedence', () => {
  const pendingBlocker = {
    id: 'a1',
    attentionRequestKind: 'blocker',
    attentionRequestReason: 'sandbox broken',
  };

  it('a pending attention request wins over a live turn', () => {
    expect(
      getAvatarStateForSession({
        ...pendingBlocker,
        status: AgentStatus.Active,
        isResponding: true,
      } as never),
    ).toBe('attention-blocker');
  });

  it('keeps the attention badge once the agent stops streaming', () => {
    expect(getAvatarStateForSession({ ...pendingBlocker, status: AgentStatus.Idle } as never)).toBe(
      'attention-blocker',
    );
  });
});

describe('getAvatarStateForSession session-derived question state', () => {
  const questionMessage: AgentMessage = {
    id: 'msg-q1',
    role: 'assistant',
    timestamp: '2026-08-17T00:00:00.000Z',
    contentBlocks: [
      {
        type: 'resource',
        resource: {
          uri: 'intent-question://tar-1',
          name: 'Auth method',
          mimeType: QUESTION_RESOURCE_MIME_TYPE,
          text: JSON.stringify({
            attachmentId: 'tar-1',
            header: 'Auth method',
            question: 'Which auth method?',
            options: [{ label: 'OAuth' }, { label: 'API key' }],
            multiSelect: false,
          }),
        },
      } as unknown as AgentMessage['contentBlocks'][number],
    ],
  };
  const blockedSession = {
    id: 'a1',
    status: AgentStatus.Idle,
    isResponding: false,
    isStreaming: false,
    isProcessing: false,
    attentionRequestKind: 'blocker',
    attentionRequestReason: 'sandbox broken',
    messages: [questionMessage],
  };

  it('derives question from the session marker even when a blocker is pending', () => {
    expect(
      getAvatarStateForSession({
        ...blockedSession,
        metadata: { pendingQuestionsMessageId: 'msg-q1' },
      } as never),
    ).toBe('question');
  });

  it('derives question from the legacy transcript tail with no marker', () => {
    expect(getAvatarStateForSession({ ...blockedSession, metadata: {} } as never)).toBe('question');
  });

  it('falls back to attention-blocker once the question is dismissed', () => {
    expect(
      getAvatarStateForSession({
        ...blockedSession,
        metadata: { pendingQuestionsMessageId: 'msg-q1', dismissedQuestionsMessageId: 'msg-q1' },
      } as never),
    ).toBe('attention-blocker');
  });

  it('falls back to attention-blocker once the marker is cleared', () => {
    expect(
      getAvatarStateForSession({
        ...blockedSession,
        metadata: { pendingQuestionsMessageId: '' },
      } as never),
    ).toBe('attention-blocker');
  });

  it('treats the caller hasQuestion option as additive, never subtractive', () => {
    expect(
      getAvatarStateForSession(
        { ...blockedSession, metadata: { pendingQuestionsMessageId: 'msg-q1' } } as never,
        { hasQuestion: false },
      ),
    ).toBe('question');
    expect(
      getAvatarStateForSession(
        { ...blockedSession, messages: [], metadata: { pendingQuestionsMessageId: '' } } as never,
        { hasQuestion: true },
      ),
    ).toBe('question');
  });
});

describe('getAvatarState completed-vs-active precedence', () => {
  it('keeps the check-mark for a completed agent with no live turn', () => {
    expect(getAvatarState({ status: AgentStatus.Idle }, { isCompleted: true })).toBe('completed');
  });

  it('renders running instead of completed while the agent is responding', () => {
    expect(
      getAvatarState({ isResponding: true, status: AgentStatus.Active }, { isCompleted: true }),
    ).toBe('running');
  });

  it('renders running instead of completed while the agent is streaming', () => {
    expect(
      getAvatarState({ isStreaming: true, status: AgentStatus.Active }, { isCompleted: true }),
    ).toBe('running');
  });

  it('renders running instead of completed for a re-woken processing agent', () => {
    expect(getAvatarState({ status: AgentStatus.Processing }, { isCompleted: true })).toBe(
      'running',
    );
  });

  it('returns to completed once the re-woken turn settles', () => {
    expect(
      getAvatarState(
        { isResponding: false, isStreaming: false, status: AgentStatus.Idle },
        { isCompleted: true },
      ),
    ).toBe('completed');
  });

  it('still prefers completed over a plain waiting status', () => {
    expect(getAvatarState({ status: AgentStatus.Waiting }, { isCompleted: true })).toBe(
      'completed',
    );
  });
});

describe('getAvatarState ladder precedence golden', () => {
  const PRECEDENCE_CHANGED =
    'getAvatarState precedence changed (ladder or AVATAR_STATE_PRECEDENCE). A reorder can flip ' +
    'every equality gate on a getAvatarState* result — re-audit the sites listed in ' +
    'avatar-state-gate-inventory.test.ts, then update the constant and this golden together.';

  type Signal = { input: AgentStateInput; options: AvatarStateOptions };

  /**
   * Minimal signal that yields each state on its own. Signals are designed to
   * be MERGEABLE: no two set the same field, except the discussion/blocker
   * pair which share `attentionKind`. Merging two signals therefore produces
   * an input that genuinely carries both states' triggers.
   */
  const signal: Record<AvatarState, Signal | null> = {
    completed: { input: {}, options: { isCompleted: true } },
    failed: { input: {}, options: { isFailed: true } },
    question: { input: {}, options: { hasQuestion: true } },
    'needs-permission': { input: {}, options: { hasPermissionRequest: true } },
    'attention-discussion': { input: {}, options: { attentionKind: 'discussion' } },
    'attention-blocker': { input: {}, options: { attentionKind: 'blocker' } },
    waiting: { input: { isWaitingForOtherAgents: true }, options: {} },
    running: { input: { status: AgentStatus.Active }, options: {} },
    unread: { input: {}, options: { hasUnread: true } },
    idle: { input: {}, options: {} },
    responding: null,
  };

  const merge = (a: Signal, b: Signal): Signal => ({
    input: { ...a.input, ...b.input },
    options: { ...a.options, ...b.options },
  });

  const sharedKeys = (a: Signal, b: Signal): string[] => [
    ...Object.keys(a.input).filter((key) => key in b.input),
    ...Object.keys(a.options).filter((key) => key in b.options),
  ];

  /** Every ordered pair `[higher, lower]` from the golden, highest first. */
  const orderedPairs = AVATAR_STATE_PRECEDENCE.flatMap((higher, index) =>
    AVATAR_STATE_PRECEDENCE.slice(index + 1).map((lower) => [higher, lower] as const),
  );

  /**
   * Pairs deliberately excluded from the pairwise sweep. Each must either be
   * physically impossible (the signals collide on a field) or carry its own
   * dedicated assertion below.
   */
  const skippedPairs: ReadonlyArray<{ pair: readonly [AvatarState, AvatarState]; reason: string }> =
    [
      {
        pair: ['completed', 'running'],
        reason: 'feasible but inverted by design — covered by the live-work exception test',
      },
      {
        pair: ['attention-discussion', 'attention-blocker'],
        reason: 'share the single attentionKind field and cannot co-occur',
      },
    ];

  const isSkipped = (higher: AvatarState, lower: AvatarState) =>
    skippedPairs.some(({ pair }) => pair[0] === higher && pair[1] === lower);

  const sweptPairs = orderedPairs.filter(([higher, lower]) => !isSkipped(higher, lower));

  it('matches the inline golden, highest priority first', () => {
    expect(AVATAR_STATE_PRECEDENCE, PRECEDENCE_CHANGED).toEqual([
      'completed',
      'failed',
      'question',
      'needs-permission',
      'attention-discussion',
      'attention-blocker',
      'waiting',
      'running',
      'unread',
      'idle',
    ]);
  });

  it.each(AVATAR_STATE_PRECEDENCE)('%s is reachable from its solo signal', (state) => {
    const solo = signal[state];
    expect(solo, `no solo signal for ${state}`).not.toBeNull();
    expect(getAvatarState(solo!.input, solo!.options)).toBe(state);
  });

  it('skips exactly the pairs whose signals collide, plus the documented exception', () => {
    const colliding = orderedPairs.filter(
      ([higher, lower]) => sharedKeys(signal[higher]!, signal[lower]!).length > 0,
    );
    expect(colliding).toEqual([['attention-discussion', 'attention-blocker']]);
    expect(skippedPairs.map(({ pair }) => pair)).toEqual([
      ['completed', 'running'],
      ['attention-discussion', 'attention-blocker'],
    ]);
    expect(sweptPairs.length).toBe(orderedPairs.length - skippedPairs.length);
  });

  it.each(sweptPairs)('%s outranks %s when both signals are present', (higher, lower) => {
    const merged = merge(signal[higher]!, signal[lower]!);
    expect(getAvatarState(merged.input, merged.options), PRECEDENCE_CHANGED).toBe(higher);
  });

  it('running is the one state that outranks completed, and only while live', () => {
    expect(
      getAvatarState({ status: AgentStatus.Active, isResponding: true }, { isCompleted: true }),
      PRECEDENCE_CHANGED,
    ).toBe('running');
    expect(
      getAvatarState({ status: AgentStatus.Idle }, { isCompleted: true }),
      PRECEDENCE_CHANGED,
    ).toBe('completed');
  });
});

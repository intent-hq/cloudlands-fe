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

  type Fixture = { input: AgentStateInput; options?: AvatarStateOptions };

  /** Minimal signal that yields each state on its own (independent of the ladder order). */
  const soloFixture: Record<AvatarState, Fixture | null> = {
    completed: { input: { status: AgentStatus.Idle }, options: { isCompleted: true } },
    failed: { input: { status: AgentStatus.Idle }, options: { isFailed: true } },
    question: { input: { status: AgentStatus.Idle }, options: { hasQuestion: true } },
    'needs-permission': {
      input: { status: AgentStatus.Idle },
      options: { hasPermissionRequest: true },
    },
    'attention-discussion': {
      input: { status: AgentStatus.Idle },
      options: { attentionKind: 'discussion' },
    },
    'attention-blocker': {
      input: { status: AgentStatus.Idle },
      options: { attentionKind: 'blocker' },
    },
    waiting: { input: { status: AgentStatus.Waiting } },
    running: { input: { status: AgentStatus.Active, isResponding: true } },
    unread: { input: { status: AgentStatus.Idle }, options: { hasUnread: true } },
    idle: { input: { status: AgentStatus.Idle } },
    responding: null,
  };

  /**
   * For each adjacent pair `[higher, lower]` in the golden, an input carrying
   * the signals of BOTH states. `attention-discussion` / `attention-blocker`
   * share the single `attentionKind` field and cannot co-occur, so that pair
   * is asserted via the solo fixtures only.
   */
  const bothSignals: Partial<Record<AvatarState, Fixture>> = {
    completed: { input: { status: AgentStatus.Error }, options: { isCompleted: true } },
    failed: { input: { status: AgentStatus.Error }, options: { hasQuestion: true } },
    question: {
      input: { status: AgentStatus.Idle },
      options: { hasQuestion: true, hasPermissionRequest: true },
    },
    'needs-permission': {
      input: { status: AgentStatus.Idle },
      options: { hasPermissionRequest: true, attentionKind: 'discussion' },
    },
    'attention-blocker': {
      input: { status: AgentStatus.Waiting },
      options: { attentionKind: 'blocker' },
    },
    waiting: { input: { status: AgentStatus.Active, isWaitingForOtherAgents: true } },
    running: {
      input: { status: AgentStatus.Active, isResponding: true },
      options: { hasUnread: true },
    },
    unread: { input: { status: AgentStatus.Idle }, options: { hasUnread: true } },
  };

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

  it.each(AVATAR_STATE_PRECEDENCE)('%s is reachable from its solo fixture', (state) => {
    const fixture = soloFixture[state];
    expect(fixture, `no solo fixture for ${state}`).not.toBeNull();
    expect(getAvatarState(fixture!.input, fixture!.options)).toBe(state);
  });

  const adjacentPairs = AVATAR_STATE_PRECEDENCE.slice(0, -1).map(
    (higher, index) => [higher, AVATAR_STATE_PRECEDENCE[index + 1]] as const,
  );

  it.each(adjacentPairs)('%s outranks %s when both signals are present', (higher, lower) => {
    const fixture = bothSignals[higher];
    if (higher === 'attention-discussion' && lower === 'attention-blocker') {
      expect(fixture).toBeUndefined();
      return;
    }
    expect(fixture, `no both-signals fixture for ${higher} > ${lower}`).toBeDefined();
    expect(getAvatarState(fixture!.input, fixture!.options), PRECEDENCE_CHANGED).toBe(higher);
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

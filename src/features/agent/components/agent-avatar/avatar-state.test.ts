import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentStatus } from '$shared/types';

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
  getAvatarState,
  getAvatarStateForSession,
  getAvatarStateFromStore,
  isAgentStreamingFromStore,
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

describe('getAvatarStateForSession attention running-vs-idle gate', () => {
  const pendingBlocker = {
    id: 'a1',
    attentionRequestKind: 'blocker',
    attentionRequestReason: 'sandbox broken',
  };

  it('suppresses a pending attention request while a turn is live (running wins)', () => {
    expect(
      getAvatarStateForSession({
        ...pendingBlocker,
        status: AgentStatus.Active,
        isResponding: true,
      } as never),
    ).toBe('running');
  });

  it('surfaces the attention badge once the agent stops streaming', () => {
    expect(getAvatarStateForSession({ ...pendingBlocker, status: AgentStatus.Idle } as never)).toBe(
      'attention-blocker',
    );
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

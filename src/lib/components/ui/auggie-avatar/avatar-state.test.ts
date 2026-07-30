import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { AgentStatus } from '$shared/types';

const {
  getStateMock,
  selectAgentSessionMock,
  selectAgentIsRespondingMock,
  selectAgentIsWaitingMock,
} = vi.hoisted(() => ({
  getStateMock: vi.fn(() => ({ marker: 'state' })),
  selectAgentSessionMock: vi.fn(),
  selectAgentIsRespondingMock: vi.fn(),
  selectAgentIsWaitingMock: vi.fn(),
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => getStateMock(),
  });
});

vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-selectors', () => ({
  selectAgentSession: {
    select: selectAgentSessionMock,
  },
}));

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', () => ({
  selectAgentSession: {
    select: selectAgentSessionMock,
  },
  selectAgentIsResponding: {
    select: selectAgentIsRespondingMock,
  },
  selectAgentIsWaiting: {
    select: selectAgentIsWaitingMock,
  },
}));

import {
  getAvatarState,
  getAvatarStateFromStore,
  isAgentStreamingFromStore,
} from './avatar-state';

describe('avatar-state store-backed selectors', () => {
  beforeEach(() => {
    getStateMock.mockClear();
    selectAgentSessionMock.mockReset();
    selectAgentIsRespondingMock.mockReset();
    selectAgentIsWaitingMock.mockReset();
  });

  it('uses selectAgentIsResponding for running state', () => {
    selectAgentSessionMock.mockReturnValue({ id: 'agent-1', status: AgentStatus.Active });
    selectAgentIsRespondingMock.mockReturnValue(true);
    selectAgentIsWaitingMock.mockReturnValue(false);

    expect(getAvatarStateFromStore('ws-1', 'agent-1')).toBe('running');
    expect(selectAgentIsRespondingMock).toHaveBeenCalledWith({ marker: 'state' }, 'agent-1');
  });

  it('lets selectAgentIsWaiting take precedence over responding for avatar state', () => {
    selectAgentSessionMock.mockReturnValue({ id: 'agent-1', status: AgentStatus.Processing });
    selectAgentIsRespondingMock.mockReturnValue(true);
    selectAgentIsWaitingMock.mockReturnValue(true);

    expect(getAvatarStateFromStore('ws-1', 'agent-1')).toBe('waiting');
  });

  it('uses selectAgentIsResponding for store-backed streaming checks', () => {
    selectAgentIsRespondingMock.mockReturnValue(true);

    expect(isAgentStreamingFromStore('ws-1', 'agent-1')).toBe(true);
    expect(selectAgentIsRespondingMock).toHaveBeenCalledWith({ marker: 'state' }, 'agent-1');
  });
});

describe('getAvatarState attention-request states', () => {
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
    expect(
      getAvatarState({ status: AgentStatus.Error }, { attentionKind: 'discussion' }),
    ).toBe('failed');
    expect(
      getAvatarState(
        { status: AgentStatus.Idle },
        { attentionKind: 'discussion', hasPermissionRequest: true },
      ),
    ).toBe('needs-permission');
  });

  it('lets attention take precedence over running/waiting', () => {
    expect(
      getAvatarState({ isStreaming: true, status: AgentStatus.Active }, { attentionKind: 'blocker' }),
    ).toBe('attention-blocker');
    expect(
      getAvatarState({ status: AgentStatus.Waiting }, { attentionKind: 'discussion' }),
    ).toBe('attention-discussion');
  });

  it('falls through unchanged when no attention request is pending', () => {
    expect(getAvatarState({ status: AgentStatus.Waiting }, { attentionKind: null })).toBe(
      'waiting',
    );
    expect(getAvatarState({ status: AgentStatus.Idle }, {})).toBe('idle');
  });
});
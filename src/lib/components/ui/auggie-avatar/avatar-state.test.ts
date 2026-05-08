import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentStatus } from '$shared/types';

const {
  getStateMock,
  selectAgentByIdMock,
  selectAgentIsRespondingMock,
  selectAgentIsWaitingMock,
} = vi.hoisted(() => ({
  getStateMock: vi.fn(() => ({ marker: 'state' })),
  selectAgentByIdMock: vi.fn(),
  selectAgentIsRespondingMock: vi.fn(),
  selectAgentIsWaitingMock: vi.fn(),
}));

vi.mock('$lib/store/redux-dispatch-bridge', () => ({
  getReduxStore: () => ({ getState: getStateMock }),
}));

vi.mock('$lib/store/slices/workspace-agents/workspace-agents-selectors', () => ({
  selectAgentById: {
    select: selectAgentByIdMock,
  },
}));

vi.mock('$lib/store/slices/agent-session/agent-session-selectors', () => ({
  selectAgentIsResponding: {
    select: selectAgentIsRespondingMock,
  },
  selectAgentIsWaiting: {
    select: selectAgentIsWaitingMock,
  },
}));

import { getAvatarStateFromStore, isAgentStreamingFromStore } from './avatar-state';

describe('avatar-state store-backed selectors', () => {
  beforeEach(() => {
    getStateMock.mockClear();
    selectAgentByIdMock.mockReset();
    selectAgentIsRespondingMock.mockReset();
    selectAgentIsWaitingMock.mockReset();
  });

  it('uses selectAgentIsResponding for running state', () => {
    selectAgentByIdMock.mockReturnValue({ id: 'agent-1', status: AgentStatus.Active });
    selectAgentIsRespondingMock.mockReturnValue(true);
    selectAgentIsWaitingMock.mockReturnValue(false);

    expect(getAvatarStateFromStore('ws-1', 'agent-1')).toBe('running');
    expect(selectAgentIsRespondingMock).toHaveBeenCalledWith({ marker: 'state' }, 'agent-1');
  });

  it('lets selectAgentIsWaiting take precedence over responding for avatar state', () => {
    selectAgentByIdMock.mockReturnValue({ id: 'agent-1', status: AgentStatus.Processing });
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
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

vi.mock('$lib/store/store', async () => {
  const { createAppStoreMockModule } = await import('$lib/store/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => getStateMock(),
  });
});

vi.mock('$lib/store/slices/workspace-agents/workspace-agents-selectors', () => ({
  selectAgentSession: {
    select: selectAgentSessionMock,
  },
}));

vi.mock('$lib/store/slices/agent-session/agent-session-selectors', () => ({
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
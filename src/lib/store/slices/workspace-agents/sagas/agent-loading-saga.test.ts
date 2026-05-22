import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import * as sagaEffects from 'redux-saga/effects';
import { AgentStatus } from '$shared/types';
import type { AgentSession } from '$shared/types';

vi.mock('typed-redux-saga', () => ({
  call: function* (fnOrDescriptor: any, ...args: any[]) {
    return yield Array.isArray(fnOrDescriptor)
      ? sagaEffects.call(fnOrDescriptor as [any, any], ...args)
      : sagaEffects.call(fnOrDescriptor, ...args);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  delay: function* (ms: number) {
    return yield sagaEffects.delay(ms);
  },
  select: function* (selector: any) {
    return yield sagaEffects.select(selector);
  },
}));

vi.mock('$lib/store/store', async () => {
  const { createAppStoreMockModule } = await import('$lib/store/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: vi.fn(),
  });
});

import {
  restoreInitialAgent,
  restoreRemainingAgents,
} from './agent-loading-saga';
import { ensureAgentSessionLoaded } from '../workspace-agents-slice';

const sessionStorageMock = {
  getItem: vi.fn(() => null),
  removeItem: vi.fn(),
  setItem: vi.fn(),
};
vi.stubGlobal('sessionStorage', sessionStorageMock);

function pendingSession(wsId: string): AgentSession {
  return {
    id: 'agent-init' as AgentSession['id'],
    backendSessionId: null,
    workspaceId: wsId as AgentSession['workspaceId'],
    name: 'Initial Agent',
    status: AgentStatus.Pending,
    messages: [],
    createdAt: '2026-05-21T00:00:00.000Z',
    updatedAt: '2026-05-21T00:00:00.000Z',
  } as AgentSession;
}

describe('restoreInitialAgent', () => {
  it('activates an already-indexed pending first agent and waits for a usable backend session', () => {
    const wsId = 'ws-init';
    const diskAgent = {
      id: 'agent-init',
      workspaceId: wsId,
      name: 'Initial Agent',
      status: 'pending',
      messages: [],
      createdAt: '2026-05-21T00:00:00.000Z',
      lastActivity: '2026-05-21T00:00:00.000Z',
      metadata: { initialMessage: 'hello', isFirstWorkspaceAgent: true },
    } as any;
    const activatedSession = {
      ...pendingSession(wsId),
      backendSessionId: 'backend-init' as AgentSession['backendSessionId'],
      status: AgentStatus.Idle,
    } as AgentSession;
    const gen = restoreInitialAgent(wsId, 'agent-init', [diskAgent], new Set(['agent-init']));

    let step = gen.next();
    expect((step.value as any).type).toBe('SELECT');
    step = gen.next(pendingSession(wsId));
    expect((step.value as any).type).toBe('SELECT');
    step = gen.next({ agentId: 'agent-init', config: { prompt: 'hello', model: 'sonnet' } });
    expect((step.value as any).type).toBe('PUT');
    const activationAction = (step.value as any).payload.action;
    expect(activationAction.type).toBe('workspaceAgents/activateInitialAgentRequested');
    expect(activationAction.payload[2]).toMatchObject({
      id: 'agent-init',
      initialMessage: 'hello',
    });

    step = gen.next();
    expect((step.value as any).type).toBe('SELECT');
    step = gen.next(pendingSession(wsId));
    expect((step.value as any).type).toBe('CALL');
    step = gen.next();
    expect((step.value as any).type).toBe('SELECT');
    step = gen.next(activatedSession);
    expect((step.value as any).type).toBe('PUT');
    expect((step.value as any).payload.action.type).toBe('workspaceAgents/markAgentRecentlyCreated');
    expect(gen.next().done).toBe(true);
  });
});

describe('restoreRemainingAgents', () => {
  it('restores an indexed regular agent when the existing shell has no usable backend session', () => {
    const wsId = 'ws-regular';
    const diskAgent = {
      id: 'agent-regular',
      workspaceId: wsId,
      name: 'Regular Agent',
      status: 'idle',
      messages: [],
      createdAt: '2026-05-21T00:00:00.000Z',
      lastActivity: '2026-05-21T00:00:00.000Z',
      sessionId: 'backend-regular',
    } as any;
    const staleShell = {
      ...pendingSession(wsId),
      id: 'agent-regular' as AgentSession['id'],
      name: 'Regular Agent',
    } as AgentSession;
    const gen = restoreRemainingAgents(wsId, [diskAgent], new Set(['agent-regular']), null);

    let step = gen.next();
    expect((step.value as any).type).toBe('SELECT');
    step = gen.next(staleShell);
    expect((step.value as any).type).toBe('PUT');
    expect((step.value as any).payload.action).toEqual(
      ensureAgentSessionLoaded(wsId, 'agent-regular'),
    );
  });
});
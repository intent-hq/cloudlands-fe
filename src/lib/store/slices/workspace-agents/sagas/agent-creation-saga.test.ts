import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import * as sagaEffects from 'redux-saga/effects';
import {
  AgentStatus,
  type AgentSession,
} from '$shared/types';
import { AgentActivationState } from '$shared/types/agent-session';

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
  race: function* (effects: any) {
    return yield sagaEffects.race(effects);
  },
  select: function* (selector: any) {
    return yield sagaEffects.select(selector);
  },
}));

const { createAgentMock } = vi.hoisted(() => ({
  createAgentMock: vi.fn(),
}));

vi.mock('$features/agent/services/agent-factory', () => ({
  agentFactory: {
    createAgent: createAgentMock,
  },
}));

vi.mock('$lib/store/store', async () => {
  const { createAppStoreMockModule } = await import('$lib/store/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: vi.fn(),
  });
});

vi.mock('$lib/utils/agent-name-generator', () => ({
  generateSpecialistAgentName: (_base: string, _existing: string[]) => 'Agent',
}));

import {
  handleActivateAgentRequestedSaga,
  handleActivateInitialAgentRequestedSaga,
  handleCreateAgentFromConfigRequestedSaga,
  handleCreateAgentRequestedSaga,
  handleCreateAgentWithSpecialistRequestedSaga,
  handleForkAgentRequestedSaga,
} from './agent-creation-saga';
import {
  activateAgentRequested,
  createAgentFromConfigRequested,
} from '../workspace-agents-slice';

function makeWorkspace(wsId: string) {
  return {
    id: wsId,
    worktreePath: '/fake/path',
    repositoryPath: '/fake/repo',
    path: '/fake',
  };
}

/**
 * Steps through a generator, providing mock values for SELECT effects based on
 * the order they appear in the saga. Returns the CALL effect to agentFactory.createAgent.
 *
 * The saga yields effects in this order:
 *   1. SELECT (selectWorkspaceById.effect)
 *   2. PUT (clearInitialAgentConfig)
 *   3. CALL (clearStaleAgentConfig)
 *   4. SELECT (selectAllWorkspaceAgents)
 *   5. SELECT (selectWorkspaceDefaultModel)
 *   6. SELECT (selectActiveProviderId)
 *   7. CALL ([agentFactory, agentFactory.createAgent])
 */
function stepToCreateAgentCall(
  gen: Generator,
  wsId: string,
  opts: { model: string; globalProvider: string },
) {
  // 1. SELECT → workspace
  let step = gen.next();
  expect(step.done).toBe(false);
  expect((step.value as any).type).toBe('SELECT');

  // provide workspace → 2. PUT(clearInitialAgentConfig)
  step = gen.next(makeWorkspace(wsId));
  expect((step.value as any).type).toBe('PUT');

  // advance past PUT → 3. CALL(clearStaleAgentConfig)
  step = gen.next();
  expect((step.value as any).type).toBe('CALL');

  // advance past CALL → 4. SELECT(agents)
  step = gen.next();
  expect((step.value as any).type).toBe('SELECT');

  // provide agents → 5. SELECT(model)
  step = gen.next([]);
  expect((step.value as any).type).toBe('SELECT');

  // provide model → 6. SELECT(globalProvider)
  step = gen.next(opts.model);
  expect((step.value as any).type).toBe('SELECT');

  // provide globalProvider → 7. CALL
  step = gen.next(opts.globalProvider);
  expect((step.value as any).type).toBe('CALL');
  return step.value as any;
}

describe('handleCreateAgentRequestedSaga — provider derivation (PR #418 regression)', () => {
  it('derives provider from compound model prefix (claude-code:default)', () => {
    const gen = handleCreateAgentRequestedSaga('ws-1');
    const callEffect = stepToCreateAgentCall(gen, 'ws-1', {
      model: 'claude-code:default',
      globalProvider: 'codex',
    });
    const config = callEffect.payload.args[1];
    expect(config.provider).toBe('claude-code');
  });

  it('falls back to global provider for unprefixed model (sonnet4.5)', () => {
    const gen = handleCreateAgentRequestedSaga('ws-2');
    const callEffect = stepToCreateAgentCall(gen, 'ws-2', {
      model: 'sonnet4.5',
      globalProvider: 'auggie',
    });
    const config = callEffect.payload.args[1];
    expect(config.provider).toBe('auggie');
  });
});

describe('handleCreateAgentWithSpecialistRequestedSaga — provider derivation (no specialist match)', () => {
  /**
   * Same stepping as handleCreateAgentRequestedSaga since specialistId=null
   * skips the specialist lookup branch entirely.
   */
  function stepSpecialistToCreateAgentCall(
    gen: Generator,
    wsId: string,
    opts: { model: string; globalProvider: string },
  ) {
    // 1. SELECT → workspace
    let step = gen.next();
    expect(step.done).toBe(false);
    expect((step.value as any).type).toBe('SELECT');

    // provide workspace → 2. PUT(clearInitialAgentConfig)
    step = gen.next(makeWorkspace(wsId));
    expect((step.value as any).type).toBe('PUT');

    // advance past PUT → 3. CALL(clearStaleAgentConfig)
    step = gen.next();
    expect((step.value as any).type).toBe('CALL');

    // advance past CALL → 4. SELECT(agents)
    step = gen.next();
    expect((step.value as any).type).toBe('SELECT');

    // provide agents → 5. SELECT(model)
    step = gen.next([]);
    expect((step.value as any).type).toBe('SELECT');

    // provide model → 6. SELECT(globalProvider)
    step = gen.next(opts.model);
    expect((step.value as any).type).toBe('SELECT');

    // provide globalProvider → 7. CALL
    step = gen.next(opts.globalProvider);
    expect((step.value as any).type).toBe('CALL');
    return step.value as any;
  }

  it('derives provider from compound model prefix (claude-code:default)', () => {
    const gen = handleCreateAgentWithSpecialistRequestedSaga('ws-3', null);
    const callEffect = stepSpecialistToCreateAgentCall(gen, 'ws-3', {
      model: 'claude-code:default',
      globalProvider: 'codex',
    });
    const config = callEffect.payload.args[1];
    expect(config.provider).toBe('claude-code');
  });

  it('falls back to global provider for unprefixed model (sonnet4.5)', () => {
    const gen = handleCreateAgentWithSpecialistRequestedSaga('ws-4', null);
    const callEffect = stepSpecialistToCreateAgentCall(gen, 'ws-4', {
      model: 'sonnet4.5',
      globalProvider: 'auggie',
    });
    const config = callEffect.payload.args[1];
    expect(config.provider).toBe('auggie');
  });
});

describe('handleCreateAgentWithSpecialistRequestedSaga — specialist lookup branch', () => {
  /**
   * Steps through the generator when a real specialist ID is provided. The saga
   * yields effects in this order when the specialist is found:
   *   1. SELECT (selectWorkspaceById.effect)
   *   2. PUT (clearInitialAgentConfig)
   *   3. CALL (clearStaleAgentConfig)
   *   4. SELECT (selectAllWorkspaceAgents)
   *   5. SELECT (selectWorkspaceDefaultModel)
   *   6. SELECT (selectActiveProviderId)
   *   7. SELECT (selectSpecialists)                — specialist lookup
   *   8. SELECT (selectEffectiveCodingAgent)       — provider override
   *   9. SELECT (selectEffectiveModel)             — model override
   *  10. SELECT (selectEffectiveBehaviorPrompt)    — behavior prompt
   *  11. CALL  ([agentFactory, agentFactory.createAgent])
   */
  function stepWithSpecialistToCreateAgentCall(
    gen: Generator,
    wsId: string,
    opts: {
      model: string;
      globalProvider: string;
      specialist: { id: string; name: string };
      effectiveProvider: string;
      effectiveModel: string;
      effectiveBehaviorPrompt: string | undefined;
    },
  ) {
    // 1. SELECT → workspace
    let step = gen.next();
    expect(step.done).toBe(false);
    expect((step.value as any).type).toBe('SELECT');

    // provide workspace → 2. PUT
    step = gen.next(makeWorkspace(wsId));
    expect((step.value as any).type).toBe('PUT');

    // advance past PUT → 3. CALL(clearStaleAgentConfig)
    step = gen.next();
    expect((step.value as any).type).toBe('CALL');

    // advance past CALL → 4. SELECT(agents)
    step = gen.next();
    expect((step.value as any).type).toBe('SELECT');

    // provide agents → 5. SELECT(model)
    step = gen.next([]);
    expect((step.value as any).type).toBe('SELECT');

    // provide model → 6. SELECT(globalProvider)
    step = gen.next(opts.model);
    expect((step.value as any).type).toBe('SELECT');

    // provide globalProvider → 7. SELECT(specialists)
    step = gen.next(opts.globalProvider);
    expect((step.value as any).type).toBe('SELECT');

    // provide specialists list (containing matching specialist) → 8. SELECT(effectiveCodingAgent)
    step = gen.next([opts.specialist]);
    expect((step.value as any).type).toBe('SELECT');

    // provide effectiveProvider → 9. SELECT(effectiveModel)
    step = gen.next(opts.effectiveProvider);
    expect((step.value as any).type).toBe('SELECT');

    // provide effectiveModel → 10. SELECT(effectiveBehaviorPrompt)
    step = gen.next(opts.effectiveModel);
    expect((step.value as any).type).toBe('SELECT');

    // provide effectiveBehaviorPrompt → 11. CALL
    step = gen.next(opts.effectiveBehaviorPrompt);
    expect((step.value as any).type).toBe('CALL');
    return step.value as any;
  }

  it('creates an agent with specialist metadata and specialist-picker source', () => {
    const gen = handleCreateAgentWithSpecialistRequestedSaga('ws-5', 'implementor');
    const callEffect = stepWithSpecialistToCreateAgentCall(gen, 'ws-5', {
      model: 'sonnet4.5',
      globalProvider: 'auggie',
      specialist: { id: 'implementor', name: 'Implementor' },
      effectiveProvider: 'claude-code',
      effectiveModel: 'opus',
      effectiveBehaviorPrompt: 'Be a careful implementor.',
    });
    const config = callEffect.payload.args[1];
    expect(config.metadata).toEqual({ specialist: 'implementor' });
    expect(config.source).toBe('specialist-picker');
    // Effective values from specialist overrides take precedence
    expect(config.provider).toBe('claude-code');
    expect(config.model).toBe('opus');
    expect(config.behaviorPrompt).toBe('Be a careful implementor.');
  });
});

describe('handleActivateAgentRequestedSaga', () => {
  it('upserts the final activated session before resolving activation waiters', async () => {
    const action = activateAgentRequested('ws-activate', 'agent-activate');
    const currentSession = {
      id: 'agent-activate',
      name: 'Pending Agent',
      workspaceId: 'ws-activate',
      status: AgentStatus.Pending,
      messages: [],
    } as AgentSession;
    const activatedSession = {
      ...currentSession,
      backendSessionId: 'backend-activated',
      status: AgentStatus.Active,
    } as AgentSession;
    const gen = handleActivateAgentRequestedSaga(action);

    let step = gen.next();
    expect((step.value as any).type).toBe('SELECT');
    step = gen.next(currentSession);
    expect((step.value as any).payload.action.type).toBe('agentSessions/upsertSession');
    expect((step.value as any).payload.action.payload[0]).toMatchObject({
      id: 'agent-activate',
      activationState: AgentActivationState.ACTIVATING,
      activationAttempts: 1,
    });
    step = gen.next();
    expect((step.value as any).type).toBe('SELECT');
    step = gen.next(makeWorkspace('ws-activate'));
    expect((step.value as any).type).toBe('CALL');
    step = gen.next(activatedSession);
    expect((step.value as any).payload.action.type).toBe('agentSessions/upsertSession');
    expect((step.value as any).payload.action.payload[0]).toMatchObject({
      id: 'agent-activate',
      backendSessionId: 'backend-activated',
      activationState: AgentActivationState.ACTIVE,
      activationAttempts: 1,
      workspaceId: 'ws-activate',
    });
    step = gen.next();
    expect((step.value as any).payload.action.type).toBe(action.success.type);
    expect((step.value as any).payload.action.payload.response).toMatchObject({
      id: 'agent-activate',
      backendSessionId: 'backend-activated',
    });
    expect(gen.next().done).toBe(true);
    await expect(action.promise).resolves.toMatchObject({ backendSessionId: 'backend-activated' });
  });
});

describe('handleCreateAgentRequestedSaga — opens agent tab via Redux (no setTimeout)', () => {
  /**
   * After createAgent resolves, the saga must:
   *   - PUT(upsertSession), PUT(markAgentRecentlyCreated)                 // registerCreatedAgent
   *   - SELECT(selectPanels.effect) inside openAgentInLayoutSaga
   *   - PUT(openTab)                                                      // no existing tab
   *
   * No setTimeout, no panel-layout-adapter call.
   */
  it('dispatches openTab when no existing agent tab is found', () => {
    const gen = handleCreateAgentRequestedSaga('ws-open');
    stepToCreateAgentCall(gen, 'ws-open', {
      model: 'sonnet4.5',
      globalProvider: 'auggie',
    });

    // 8. createAgent resolves with success → registerCreatedAgent: PUT(upsertSession)
    let step = gen.next({ success: true, agent: { id: 'agent-new', name: 'Agent' } });
    expect((step.value as any).type).toBe('PUT');
    expect((step.value as any).payload.action.type).toBe('agentSessions/upsertSession');
    expect((step.value as any).payload.action.payload[0].workspaceId).toBe('ws-open');

    // 9. PUT(markAgentRecentlyCreated)
    step = gen.next();
    expect((step.value as any).type).toBe('PUT');
    expect((step.value as any).payload.action.type).toBe('workspaceAgents/markAgentRecentlyCreated');

    // 10. SELECT(selectPanels) inside openAgentInLayoutSaga
    step = gen.next();
    expect((step.value as any).type).toBe('SELECT');

    // Provide empty panels → no existing tab branch → 11. PUT(openTab)
    step = gen.next({});
    expect((step.value as any).type).toBe('PUT');
    const openTabAction = (step.value as any).payload.action;
    expect(openTabAction.type).toBe('panelLayout/openTab');
    expect(openTabAction.payload.wsId).toBe('ws-open');
    expect(openTabAction.payload.tab).toMatchObject({
      type: 'agent',
      agentId: 'agent-new',
      title: 'Agent',
      closable: true,
    });

    // Saga completes
    expect(gen.next().done).toBe(true);
  });

  it('focuses an existing agent tab without dispatching openTab', () => {
    const gen = handleCreateAgentRequestedSaga('ws-focus');
    stepToCreateAgentCall(gen, 'ws-focus', {
      model: 'sonnet4.5',
      globalProvider: 'auggie',
    });

    // createAgent → registerCreatedAgent (2 PUTs)
    let step = gen.next({ success: true, agent: { id: 'agent-existing', name: 'Agent' } });
    expect((step.value as any).type).toBe('PUT'); // upsertSession
    expect((step.value as any).payload.action.type).toBe('agentSessions/upsertSession');
    step = gen.next();
    expect((step.value as any).type).toBe('PUT'); // markAgentRecentlyCreated

    // SELECT(selectPanels)
    step = gen.next();
    expect((step.value as any).type).toBe('SELECT');

    // Provide panels containing this agent → focusPanel + setActiveTab path
    const panels = {
      'panel-1': {
        id: 'panel-1',
        tabs: [{ id: 'tab-1', type: 'agent', agentId: 'agent-existing', title: 'Agent' }],
        activeTabId: null,
      },
    };
    step = gen.next(panels);
    expect((step.value as any).type).toBe('PUT');
    const focusAction = (step.value as any).payload.action;
    expect(focusAction.type).toBe('panelLayout/focusPanel');
    expect(focusAction.payload).toEqual(['ws-focus', 'panel-1']);

    step = gen.next();
    expect((step.value as any).type).toBe('PUT');
    const setActiveAction = (step.value as any).payload.action;
    expect(setActiveAction.type).toBe('panelLayout/setActiveTab');
    expect(setActiveAction.payload).toEqual(['ws-focus', 'tab-1', 'panel-1']);

    // Saga completes
    expect(gen.next().done).toBe(true);
  });
});

describe('new saga-owned agent creation request handlers', () => {
  it('creates an agent from explicit config and registers the created session', () => {
    const gen = handleCreateAgentFromConfigRequestedSaga('ws-config', {
      id: 'agent-config',
      workspaceId: 'stale-ws' as any,
      name: 'Config Agent',
      model: 'selector-model',
      source: 'unit-test',
    });

    let step = gen.next();
    expect((step.value as any).type).toBe('SELECT');

    step = gen.next(makeWorkspace('ws-config'));
    expect((step.value as any).type).toBe('SELECT');

    step = gen.next([]);
    expect((step.value as any).type).toBe('CALL');
    const config = (step.value as any).payload.args[1];
    expect(config).toMatchObject({
      id: 'agent-config',
      workspaceId: 'ws-config',
      name: 'Config Agent',
    });

    step = gen.next({ success: true, agent: { id: 'agent-config', name: 'Config Agent' } });
    expect((step.value as any).payload.action.type).toBe('agentSessions/upsertSession');
    expect((step.value as any).payload.action.payload[0].workspaceId).toBe('ws-config');
    step = gen.next();
    expect((step.value as any).payload.action.type).toBe('workspaceAgents/markAgentRecentlyCreated');
    step = gen.next();
    expect((step.value as any).payload.action.type).toBe('workspaceAgents/setActiveAgentId');
    expect(gen.next().done).toBe(true);
  });

  it('confirms async config creation only after the created session is registered', async () => {
    const request = createAgentFromConfigRequested('ws-config', {
      id: 'agent-config',
      workspaceId: 'stale-ws' as any,
      name: 'Config Agent',
      model: 'selector-model',
      source: 'unit-test',
    });
    const createdAgent = { id: 'agent-config', name: 'Config Agent' } as any;
    const resolution = expect(request.promise).resolves.toBe(createdAgent);
    const gen = handleCreateAgentFromConfigRequestedSaga(
      'ws-config',
      request.payload[1],
      request.payload[2],
      request,
    );

    let step = gen.next();
    expect((step.value as any).type).toBe('SELECT');
    step = gen.next(makeWorkspace('ws-config'));
    expect((step.value as any).type).toBe('SELECT');
    step = gen.next([]);
    expect((step.value as any).type).toBe('CALL');
    step = gen.next({ success: true, agent: createdAgent });
    expect((step.value as any).payload.action.type).toBe('agentSessions/upsertSession');
    step = gen.next();
    expect((step.value as any).payload.action.type).toBe('workspaceAgents/markAgentRecentlyCreated');
    step = gen.next();
    expect((step.value as any).payload.action.type).toBe('workspaceAgents/setActiveAgentId');
    step = gen.next();
    expect((step.value as any).payload.action.type).toBe('workspaceAgents/createAgentFromConfigRequested_SUCCESS');
    expect(gen.next().done).toBe(true);
    await resolution;
  });

  it('rejects async config creation without registering a failed session', async () => {
    const request = createAgentFromConfigRequested('ws-config', {
      id: 'agent-config',
      workspaceId: 'stale-ws' as any,
      name: 'Config Agent',
      model: 'selector-model',
      source: 'unit-test',
    });
    const rejection = expect(request.promise).rejects.toBe('creation failed');
    const gen = handleCreateAgentFromConfigRequestedSaga(
      'ws-config',
      request.payload[1],
      request.payload[2],
      request,
    );

    let step = gen.next();
    expect((step.value as any).type).toBe('SELECT');
    step = gen.next(makeWorkspace('ws-config'));
    expect((step.value as any).type).toBe('SELECT');
    step = gen.next([]);
    expect((step.value as any).type).toBe('CALL');
    step = gen.next({ success: false, error: 'creation failed' });
    expect((step.value as any).payload.action.type).toBe('workspaceAgents/createAgentFromConfigRequested_FAILURE');
    expect(gen.next().done).toBe(true);
    await rejection;
  });

  it('routes initial-agent activation through the saga-owned factory call', () => {
    const gen = handleActivateInitialAgentRequestedSaga('ws-init', 'agent-init', {
      id: 'agent-init',
      workspaceId: 'ws-init' as any,
      name: 'Initial Agent',
      model: 'sonnet',
      initialMessage: 'hello',
    });

    let step = gen.next();
    expect((step.value as any).type).toBe('SELECT');
    step = gen.next(makeWorkspace('ws-init'));
    expect((step.value as any).type).toBe('SELECT');
    step = gen.next([]);
    expect((step.value as any).type).toBe('SELECT');
    step = gen.next(undefined);
    expect((step.value as any).type).toBe('RACE');
    expect((step.value as any).payload).toHaveProperty('result');
    expect((step.value as any).payload).toHaveProperty('timeout');
  });

  it('creates forked agents in the saga with cloned history metadata', () => {
    const gen = handleForkAgentRequestedSaga('ws-fork', {
      forkedAgentId: 'agent-fork',
      sourceAgentId: 'agent-parent',
      name: 'Forked Agent',
      model: 'opus',
      messages: [{ id: 'msg-1', role: 'user', content: 'hello' } as any],
      forkPoint: 1,
      selectedText: 'hello',
    });

    let step = gen.next();
    expect((step.value as any).type).toBe('SELECT');
    step = gen.next(makeWorkspace('ws-fork'));
    expect((step.value as any).type).toBe('SELECT');
    step = gen.next({ id: 'agent-parent', workspaceId: 'ws-fork', name: 'Parent' });
    expect((step.value as any).type).toBe('CALL');
    const config = (step.value as any).payload.args[1];
    expect(config).toMatchObject({
      id: 'agent-fork',
      workspaceId: 'ws-fork',
      name: 'Forked Agent',
      source: 'chat-panel',
      metadata: expect.objectContaining({ parentSessionId: 'agent-parent', forkPoint: 1 }),
    });

    step = gen.next({ success: true, agent: { id: 'agent-fork', name: 'Forked Agent' } });
    expect((step.value as any).payload.action.type).toBe('agentSessions/upsertSession');
    expect((step.value as any).payload.action.payload[0].workspaceId).toBe('ws-fork');
    step = gen.next();
    expect((step.value as any).payload.action.type).toBe('agentSessions/upsertSession');
    expect((step.value as any).payload.action.payload[0].workspaceId).toBe('ws-fork');
    step = gen.next();
    expect((step.value as any).type).toBe('CALL');
  });
});

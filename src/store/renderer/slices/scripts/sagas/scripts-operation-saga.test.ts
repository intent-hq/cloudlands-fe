import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import { withLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { store } from '../../../store';

const transport = vi.hoisted(() => ({
  create: vi.fn(),
  detectCandidates: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  remove: vi.fn(),
  restart: vi.fn(),
  saveRepoScripts: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  status: vi.fn(),
  upsert: vi.fn(),
}));
vi.mock('$features/scripts/script-definition-transport', () => ({
  scriptDefinitionTransport: transport,
}));
vi.mock('./scripts-output-saga', () => ({ scriptsOutputSaga: function* () {} }));
vi.mock('$lib/components/patterns/notify', () => ({ notify: { error: vi.fn() } }));

import {
  appendScriptOutput,
  applyScriptDefinitionChangesRequested,
  createScriptFixAgentRequested,
  createScriptDefinitionRequested,
  detectScriptDefinitionsRequested,
  detectScriptsWithAgentRequested,
  removeScriptDefinitionsRequested,
  removeScriptDefinitionRequested,
  refreshScripts,
  restoreScriptDefinitionsRequested,
  deleteScriptRequested,
  scriptWorkflowReleased,
  scriptsReducer,
  setScriptsData,
  updateScriptDefinitionRequested,
} from '../scripts-slice';
import { scriptsOperationSaga } from './scripts-operation-saga';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import {
  backgroundAgentExecutorReducer,
  cancelExecution,
  executeBackgroundAgent,
  setExecutorState,
} from '../../background-agent-executor/background-agent-executor-slice';
import { createAgentFromConfigRequested } from '../../workspace-agents/workspace-agents-slice';

const WS = 'ws-1';
const definition = {
  id: 'script-1',
  workspaceId: WS,
  name: 'Check',
  command: 'pnpm check',
  mode: 'command' as const,
  source: 'auto-detected',
  createdAt: '2026-10-09',
  runtime: { status: 'idle' as const, restartCount: 0 },
};

type DispatchedAction = { type: string; payload?: unknown; promise?: Promise<unknown> };

function start() {
  const channel = stdChannel();
  const actions: DispatchedAction[] = [];
  const state = withLegacyPrincipal({
    scripts: scriptsReducer(undefined, { type: '@@init' }),
    bgExecutor: backgroundAgentExecutorReducer(undefined, { type: '@@init' }),
    workspace: { workspaces: createCollection('id', [{ id: WS, myRole: 'owner' }]) },
  });
  const dispatch = (action: DispatchedAction) => {
    state.scripts = scriptsReducer(state.scripts, action);
    state.bgExecutor = backgroundAgentExecutorReducer(state.bgExecutor, action);
    actions.push(action);
    channel.put(action);
    return action;
  };
  const task = runSaga({ channel, dispatch, getState: () => state }, scriptsOperationSaga);
  return { actions, channel, dispatch, state, task };
}

async function stop(task: Task) {
  task.cancel();
  await task.toPromise();
}

afterEach(() => {
  store.dispose();
  vi.clearAllMocks();
});

describe('scriptsOperationSaga definition ownership', () => {
  it('creates through the transport and settles the compatibility promise', async () => {
    transport.create.mockResolvedValueOnce({ success: true, script: definition });
    const run = start();
    const request = createScriptDefinitionRequested(WS, {
      name: definition.name,
      command: definition.command,
      mode: definition.mode,
    });
    run.channel.put(request);

    await expect(request.promise).resolves.toEqual(definition);
    expect(transport.create).toHaveBeenCalledWith(WS, request.payload[1]);
    expect(run.actions).toContainEqual(refreshScripts(WS));
    await stop(run.task);
  });

  it('reads before updating and holds the edit reservation through its upsert', async () => {
    store.init();
    const current = {
      ...definition,
      healthUrl: 'http://localhost:3100/health',
      readyPattern: 'READY',
    };
    transport.get.mockResolvedValueOnce(current);
    transport.upsert.mockResolvedValueOnce({
      success: true,
      script: { ...current, name: 'Renamed', healthUrl: 'http://localhost:3100/ready' },
    });
    const run = start();
    run.dispatch(setScriptsData(WS, [definition]));
    const request = updateScriptDefinitionRequested(WS, definition.id, {
      name: 'Renamed',
      healthUrl: 'http://localhost:3100/ready',
      readyPattern: 'READY_FOR_WORK',
    });
    run.channel.put(request);

    await expect(request.promise).resolves.toEqual({
      ...current,
      name: 'Renamed',
      healthUrl: 'http://localhost:3100/ready',
    });
    expect(transport.get).toHaveBeenCalledWith(WS, definition.id);
    expect(transport.upsert).toHaveBeenCalledWith(
      WS,
      definition.id,
      expect.objectContaining({
        name: 'Renamed',
        healthUrl: 'http://localhost:3100/ready',
        readyPattern: 'READY_FOR_WORK',
      }),
    );
    await stop(run.task);
  });

  it('updates an off-page definition without requiring a cached row', async () => {
    transport.get.mockResolvedValueOnce(definition);
    transport.upsert.mockResolvedValueOnce({ success: true, script: definition });
    const run = start();
    const request = updateScriptDefinitionRequested(WS, definition.id, { name: 'Renamed' });
    run.channel.put(request);

    await expect(request.promise).resolves.toEqual(definition);
    expect(transport.get).toHaveBeenCalledWith(WS, definition.id);
    expect(transport.upsert).toHaveBeenCalledOnce();
    await stop(run.task);
  });

  it('forwards explicit empty update fields while retaining readiness settings', async () => {
    const current = {
      ...definition,
      cwd: 'app',
      env: { PORT: '3000' },
      healthUrl: 'http://localhost:3100/health',
      readyPattern: 'READY',
    };
    transport.get.mockResolvedValueOnce(current);
    transport.upsert.mockResolvedValueOnce({ success: true, script: current });
    const run = start();
    const request = updateScriptDefinitionRequested(WS, definition.id, { cwd: '', env: {} });
    run.channel.put(request);

    await expect(request.promise).resolves.toEqual(current);
    expect(transport.upsert).toHaveBeenCalledWith(
      WS,
      definition.id,
      expect.objectContaining({
        cwd: '',
        env: {},
        healthUrl: current.healthUrl,
        readyPattern: current.readyPattern,
      }),
    );
    await stop(run.task);
  });

  it('rejects an overlapping edit without releasing the first reservation', async () => {
    let resolveRead!: (value: typeof definition) => void;
    transport.get.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRead = resolve;
      }),
    );
    transport.upsert.mockResolvedValueOnce({ success: true, script: definition });
    const run = start();
    run.dispatch(setScriptsData(WS, [definition]));
    const first = updateScriptDefinitionRequested(WS, definition.id, { name: 'First' });
    const second = updateScriptDefinitionRequested(WS, definition.id, { name: 'Second' });
    run.channel.put(first);
    run.channel.put(second);

    await expect(second.promise).rejects.toThrow('pending change');
    expect(transport.get).toHaveBeenCalledOnce();
    resolveRead(definition);
    await expect(first.promise).resolves.toEqual(definition);
    await stop(run.task);
  });

  it('suppresses a removal completion invalidated by workspace cleanup', async () => {
    let resolveRemoval!: (value: { success: true }) => void;
    transport.get.mockResolvedValueOnce(definition);
    transport.remove.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRemoval = resolve;
      }),
    );
    const run = start();
    run.dispatch(setScriptsData(WS, [definition]));
    const request = removeScriptDefinitionRequested(WS, definition.id);
    run.channel.put(request);
    await vi.waitFor(() => expect(transport.remove).toHaveBeenCalledOnce());
    run.dispatch(workspaceUnmounted(WS));
    resolveRemoval({ success: true });

    await expect(request.promise).resolves.toBeUndefined();
    expect(run.state.scripts.byWorkspaceId[WS].scripts[definition.id]).toBeDefined();
    expect(run.state.scripts.byWorkspaceId[WS].operations).toEqual({});
    await stop(run.task);
  });

  it('captures a full inventory snapshot before applying changes', async () => {
    const current = {
      ...definition,
      healthUrl: 'http://localhost:3100/health',
      readyPattern: 'READY',
    };
    transport.list.mockResolvedValueOnce([current]);
    transport.upsert.mockResolvedValueOnce({ success: true, script: definition });
    const run = start();
    const request = applyScriptDefinitionChangesRequested(WS, {
      add: [],
      remove: [],
      update: [{ id: definition.id, updates: { command: 'pnpm verify' } }],
    });
    run.channel.put(request);

    await expect(request.promise).resolves.toMatchObject({
      snapshot: [expect.objectContaining({ id: definition.id, healthUrl: current.healthUrl })],
      updated: 1,
    });
    expect(transport.list).toHaveBeenCalledWith(WS, { archive: 'active' });
    expect(transport.upsert).toHaveBeenCalledWith(
      WS,
      definition.id,
      expect.objectContaining({ healthUrl: current.healthUrl, readyPattern: current.readyPattern }),
    );
    await stop(run.task);
  });

  it('skips non-auto-detected agent changes without aborting the remaining batch', async () => {
    const userDefinition = {
      ...definition,
      id: 'user-script',
      name: 'User script',
      source: 'user',
    };
    transport.list.mockResolvedValueOnce([definition, userDefinition]);
    transport.remove.mockResolvedValueOnce({ success: true });
    transport.create.mockResolvedValueOnce({ success: true, script: definition });
    const run = start();
    const request = applyScriptDefinitionChangesRequested(
      WS,
      {
        add: [{ name: 'New script', command: 'pnpm new', mode: 'command' }],
        remove: [definition.id],
        update: [{ id: userDefinition.id, updates: { command: 'pnpm changed' } }],
      },
      [definition, userDefinition],
    );
    run.channel.put(request);

    await expect(request.promise).resolves.toMatchObject({ added: 1, removed: 1, updated: 0 });
    expect(transport.remove).toHaveBeenCalledWith(WS, definition.id);
    expect(transport.upsert).not.toHaveBeenCalled();
    await stop(run.task);
  });

  it('rechecks authority before each agent-detection write', async () => {
    let resolveRemoval!: (value: { success: true }) => void;
    transport.list.mockResolvedValueOnce([definition]);
    transport.remove.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRemoval = resolve;
      }),
    );
    const run = start();
    const request = applyScriptDefinitionChangesRequested(WS, {
      add: [{ name: 'Later', command: 'pnpm later', mode: 'command' }],
      remove: [definition.id],
      update: [],
    });
    run.channel.put(request);
    await vi.waitFor(() => expect(transport.remove).toHaveBeenCalledOnce());
    run.state.workspace.workspaces = createCollection('id', []);
    resolveRemoval({ success: true });

    await expect(request.promise).rejects.toThrow();
    expect(transport.create).not.toHaveBeenCalled();
    await stop(run.task);
  });

  it('skips an apply entry when the reviewed definition changed before the batch', async () => {
    const reviewed = { ...definition, updatedAt: 'reviewed' };
    transport.list.mockResolvedValueOnce([{ ...definition, updatedAt: 'newer' }]);
    const run = start();
    const request = applyScriptDefinitionChangesRequested(
      WS,
      { add: [], remove: [], update: [{ id: definition.id, updates: { name: 'Renamed' } }] },
      [reviewed],
      'consumer-1',
    );
    run.channel.put(request);

    await expect(request.promise).resolves.toMatchObject({ updated: 0 });
    expect(transport.upsert).not.toHaveBeenCalled();
    await stop(run.task);
  });

  it('stops an apply batch when its workflow consumer releases', async () => {
    let resolveUpdate!: (value: { success: true; script: typeof definition }) => void;
    transport.list.mockResolvedValueOnce([definition]);
    transport.upsert.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveUpdate = resolve;
      }),
    );
    const run = start();
    const consumer = {
      consumerId: 'consumer-1',
      requestId: 'request-1',
      resourceId: 'agent-detection',
    };
    const request = applyScriptDefinitionChangesRequested(
      WS,
      {
        add: [{ name: 'Later', command: 'pnpm later', mode: 'command' }],
        remove: [],
        update: [{ id: definition.id, updates: { command: 'pnpm verify' } }],
      },
      [definition],
      consumer,
    );
    run.channel.put(request);
    await vi.waitFor(() => expect(transport.upsert).toHaveBeenCalledOnce());
    run.dispatch(scriptWorkflowReleased(WS, consumer.consumerId));
    await Promise.resolve();
    expect(run.state.scripts.byWorkspaceId[WS].detectionOperation?.pending).toBe(true);
    resolveUpdate({ success: true, script: definition });
    await expect(request.promise).rejects.toThrow('cancelled');
    expect(run.state.scripts.byWorkspaceId[WS].detectionOperation).toBeUndefined();
    expect(transport.create).not.toHaveBeenCalled();
    await stop(run.task);
  });

  it('deletes a live script through the explicit lifecycle action', async () => {
    const running = { ...definition, runtime: { status: 'running' as const, restartCount: 0 } };
    transport.remove.mockResolvedValueOnce({ success: true });
    const run = start();
    run.dispatch(setScriptsData(WS, [running]));
    run.channel.put(deleteScriptRequested(WS, running.id, 'Delete failed'));

    await vi.waitFor(() => expect(transport.remove).toHaveBeenCalledWith(WS, running.id));
    expect(run.state.scripts.byWorkspaceId[WS].scripts[running.id]).toBeUndefined();
    await stop(run.task);
  });

  it('reports individual bulk-removal failures while preserving successful removals', async () => {
    const second = { ...definition, id: 'script-2', name: 'Second' };
    transport.get.mockResolvedValueOnce(definition).mockResolvedValueOnce(second);
    transport.remove
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false, error: 'second failed' });
    const run = start();
    const request = removeScriptDefinitionsRequested(
      WS,
      [definition, second],
      'Unable to remove script',
    );
    run.channel.put(request);

    await expect(request.promise).resolves.toEqual({
      removed: [definition.id],
      failed: [{ scriptId: second.id, error: 'second failed' }],
    });
    expect(transport.remove).toHaveBeenNthCalledWith(1, WS, definition.id);
    expect(transport.remove).toHaveBeenNthCalledWith(2, WS, second.id);
    await stop(run.task);
  });

  it('finishes durable bulk removal after its UI consumer releases', async () => {
    const second = { ...definition, id: 'script-2', name: 'Second' };
    let resolveRemoval!: (value: { success: true }) => void;
    transport.get.mockResolvedValueOnce(definition).mockResolvedValueOnce(second);
    transport.remove
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveRemoval = resolve;
        }),
      )
      .mockResolvedValueOnce({ success: true });
    const run = start();
    const consumer = {
      consumerId: 'consumer-1',
      requestId: 'request-1',
      resourceId: 'bulk-remove',
    };
    const request = removeScriptDefinitionsRequested(
      WS,
      [definition, second],
      'Unable to remove script',
      consumer,
    );
    run.channel.put(request);
    await vi.waitFor(() => expect(transport.remove).toHaveBeenCalledOnce());
    run.dispatch(scriptWorkflowReleased(WS, consumer.consumerId));
    resolveRemoval({ success: true });

    await expect(request.promise).resolves.toEqual({
      removed: [definition.id, second.id],
      failed: [],
    });
    expect(transport.get).toHaveBeenCalledTimes(2);
    expect(transport.remove).toHaveBeenCalledTimes(2);
    expect(run.state.scripts.byWorkspaceId[WS].workflowOutcomes).toBeUndefined();
    await stop(run.task);
  });

  it('records a settled removal without stale publication after authority loss', async () => {
    let resolveRemoval!: (value: { success: true }) => void;
    transport.get.mockResolvedValueOnce(definition);
    transport.remove.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRemoval = resolve;
      }),
    );
    const run = start();
    run.dispatch(setScriptsData(WS, [definition]));
    const request = removeScriptDefinitionsRequested(WS, [definition], 'Unable to remove script');
    run.channel.put(request);
    await vi.waitFor(() => expect(transport.remove).toHaveBeenCalledOnce());
    run.state.workspace.workspaces = createCollection('id');
    resolveRemoval({ success: true });

    await expect(request.promise).resolves.toEqual({ removed: [definition.id], failed: [] });
    expect(run.state.scripts.byWorkspaceId[WS].scripts[definition.id]).toBeDefined();
    await stop(run.task);
  });

  it('applies legacy agent detection results through the registered saga', async () => {
    const detected = { name: 'Build', command: 'pnpm build', mode: 'command' as const };
    transport.list.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    transport.create.mockResolvedValueOnce({
      success: true,
      script: { ...definition, id: 'script-build', ...detected },
    });
    const run = start();
    const request = detectScriptsWithAgentRequested(WS);
    run.channel.put(request);

    await vi.waitFor(() =>
      expect(run.actions.some((action) => action.type === executeBackgroundAgent.type)).toBe(true),
    );
    const execute = run.actions.find((action) => action.type === executeBackgroundAgent.type) as
      ReturnType<typeof executeBackgroundAgent> | undefined;
    const requestId = execute?.payload[2]?.requestId;
    expect(requestId).toEqual(expect.any(String));
    run.dispatch(
      setExecutorState(WS, 'script-detect', {
        status: 'running',
        executionContext: { requestId },
      }),
    );
    run.dispatch(
      setExecutorState(WS, 'script-detect', {
        status: 'success',
        result: JSON.stringify([detected, detected]),
        executionContext: { requestId },
      }),
    );

    await expect(request.promise).resolves.toMatchObject({
      source: 'agent',
      presentation: 'legacy',
      changes: { added: 1 },
    });
    expect(transport.create).toHaveBeenCalledOnce();
    await stop(run.task);
  });

  it('falls back locally and identifies an unexpected agent result', async () => {
    transport.list.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    transport.detectCandidates.mockResolvedValueOnce({ candidates: [], packageManager: 'pnpm' });
    const run = start();
    const request = detectScriptsWithAgentRequested(WS);
    run.channel.put(request);

    await vi.waitFor(() =>
      expect(run.actions.some((action) => action.type === executeBackgroundAgent.type)).toBe(true),
    );
    const execute = run.actions.find((action) => action.type === executeBackgroundAgent.type) as
      ReturnType<typeof executeBackgroundAgent> | undefined;
    const requestId = execute?.payload[2]?.requestId;
    run.dispatch(
      setExecutorState(WS, 'script-detect', {
        status: 'running',
        executionContext: { requestId },
      }),
    );
    run.dispatch(
      setExecutorState(WS, 'script-detect', {
        status: 'success',
        result: 'not json',
        executionContext: { requestId },
      }),
    );

    await expect(request.promise).resolves.toMatchObject({
      source: 'local',
      fallbackReason: 'unexpected-format',
      detection: { detected: 0 },
    });
    await stop(run.task);
  });

  it('falls back locally when applying agent changes fails', async () => {
    transport.list
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('apply inventory failed'))
      .mockResolvedValueOnce([]);
    transport.detectCandidates.mockResolvedValueOnce({ candidates: [], packageManager: 'pnpm' });
    const run = start();
    const request = detectScriptsWithAgentRequested(WS);
    run.channel.put(request);

    await vi.waitFor(() =>
      expect(run.actions.some((action) => action.type === executeBackgroundAgent.type)).toBe(true),
    );
    const execute = run.actions.find((action) => action.type === executeBackgroundAgent.type) as
      ReturnType<typeof executeBackgroundAgent> | undefined;
    const requestId = execute?.payload[2]?.requestId;
    run.dispatch(
      setExecutorState(WS, 'script-detect', {
        status: 'running',
        executionContext: { requestId },
      }),
    );
    run.dispatch(
      setExecutorState(WS, 'script-detect', {
        status: 'success',
        result: JSON.stringify({
          add: [{ name: 'Build', command: 'pnpm build', mode: 'command' }],
          update: [],
          remove: [],
        }),
        executionContext: { requestId },
      }),
    );

    await expect(request.promise).resolves.toMatchObject({
      source: 'local',
      fallbackReason: 'apply-failed',
      detection: { detected: 0 },
    });
    await stop(run.task);
  });

  it('settles a superseded detector without cancelling the newer execution', async () => {
    transport.list.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const run = start();
    const first = detectScriptsWithAgentRequested(WS);
    run.channel.put(first);

    await vi.waitFor(() =>
      expect(
        run.actions.filter((action) => action.type === executeBackgroundAgent.type),
      ).toHaveLength(1),
    );
    const firstExecute = run.actions.find(
      (action) => action.type === executeBackgroundAgent.type,
    ) as ReturnType<typeof executeBackgroundAgent>;
    run.dispatch(
      setExecutorState(WS, 'script-detect', {
        status: 'running',
        executionContext: { requestId: firstExecute.payload[2]?.requestId },
      }),
    );

    const second = detectScriptsWithAgentRequested(WS);
    run.channel.put(second);
    await vi.waitFor(() =>
      expect(
        run.actions.filter((action) => action.type === executeBackgroundAgent.type),
      ).toHaveLength(2),
    );
    const executions = run.actions.filter(
      (action) => action.type === executeBackgroundAgent.type,
    ) as ReturnType<typeof executeBackgroundAgent>[];
    const secondRequestId = executions[1].payload[2]?.requestId;
    run.dispatch(
      setExecutorState(WS, 'script-detect', {
        status: 'running',
        executionContext: { requestId: secondRequestId },
      }),
    );
    run.dispatch(
      setExecutorState(WS, 'script-detect', {
        status: 'success',
        result: JSON.stringify({ add: [], update: [], remove: [] }),
        executionContext: { requestId: secondRequestId },
      }),
    );

    await expect(first.promise).rejects.toThrow('superseded');
    await expect(second.promise).resolves.toMatchObject({ source: 'agent' });
    expect(run.actions.filter((action) => action.type === cancelExecution.type)).toHaveLength(0);
    await stop(run.task);
  });

  it('cancels only the matching detector execution when its consumer releases', async () => {
    transport.list.mockResolvedValueOnce([]);
    const run = start();
    const consumer = {
      consumerId: 'detect-consumer',
      requestId: 'detect-workflow',
      resourceId: 'agent-detection',
    };
    const request = detectScriptsWithAgentRequested(WS, consumer);
    run.channel.put(request);

    await vi.waitFor(() =>
      expect(run.actions.some((action) => action.type === executeBackgroundAgent.type)).toBe(true),
    );
    const execute = run.actions.find((action) => action.type === executeBackgroundAgent.type) as
      ReturnType<typeof executeBackgroundAgent> | undefined;
    run.dispatch(
      setExecutorState(WS, 'script-detect', {
        status: 'running',
        executionContext: { requestId: execute?.payload[2]?.requestId },
      }),
    );
    run.dispatch(scriptWorkflowReleased(WS, consumer.consumerId));

    await expect(request.promise).rejects.toThrow('cancelled');
    expect(run.actions).toContainEqual(cancelExecution(WS, 'script-detect'));
    await stop(run.task);
  });

  it('prepares a fix agent from the full definition and live output tail', async () => {
    store.init();
    transport.get.mockResolvedValueOnce({
      ...definition,
      command: 'pnpm check --full',
      runtime: { status: 'exited', exitCode: 2, restartCount: 0 },
    });
    const run = start();
    run.dispatch(
      appendScriptOutput(WS, definition.id, {
        text: 'live failure\n',
        timestamp: '2026-10-15T00:00:00Z',
      }),
    );
    run.channel.put(createScriptFixAgentRequested(WS, definition.id, 'retained failure'));

    await vi.waitFor(() =>
      expect(
        run.actions.some((action) => action.type === createAgentFromConfigRequested.type),
      ).toBe(true),
    );
    const create = run.actions.find(
      (action) => action.type === createAgentFromConfigRequested.type,
    ) as ReturnType<typeof createAgentFromConfigRequested> | undefined;
    expect(create?.payload).toEqual([
      WS,
      expect.objectContaining({
        workspaceId: WS,
        source: 'error-notification',
        initialMessage: expect.stringContaining('Command: `pnpm check --full`'),
      }),
      { openAgent: true },
    ]);
    expect(create?.payload[1].initialMessage).toContain('failed with exit code 2');
    expect(create?.payload[1].initialMessage).toContain('live failure');
    expect(create?.payload[1].initialMessage).not.toContain('retained failure');
    await stop(run.task);
  });

  it('suppresses fix-agent creation when its consumer releases during the definition read', async () => {
    store.init();
    let resolveDefinition!: (value: typeof definition) => void;
    transport.get.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDefinition = resolve;
      }),
    );
    const run = start();
    await Promise.resolve();
    run.channel.put(
      createScriptFixAgentRequested(WS, definition.id, undefined, 'fix-agent-consumer'),
    );
    await vi.waitFor(() => expect(transport.get).toHaveBeenCalledOnce());
    run.dispatch(scriptWorkflowReleased(WS, 'fix-agent-consumer'));
    await Promise.resolve();
    resolveDefinition(definition);
    await Promise.resolve();

    expect(run.actions.some((action) => action.type === createAgentFromConfigRequested.type)).toBe(
      false,
    );
    await stop(run.task);
  });

  it('restores source provenance with the full definition snapshot', async () => {
    transport.list.mockResolvedValueOnce([]);
    transport.create.mockResolvedValueOnce({ success: true, script: definition });
    const run = start();
    const request = restoreScriptDefinitionsRequested(WS, [definition]);
    run.channel.put(request);

    await expect(request.promise).resolves.toBeUndefined();
    expect(transport.create).toHaveBeenCalledWith(
      WS,
      expect.objectContaining({ source: 'auto-detected' }),
    );
    await stop(run.task);
  });

  it('skips live detection changes without calling the destructive upsert', async () => {
    transport.detectCandidates.mockResolvedValueOnce({
      candidates: [{ name: 'Check', command: 'pnpm verify', mode: 'command', category: 'test' }],
      packageManager: 'pnpm',
    });
    transport.list.mockResolvedValueOnce([
      { ...definition, runtime: { status: 'running', restartCount: 0 }, category: 'test' },
    ]);
    const run = start();
    const request = detectScriptDefinitionsRequested(WS);
    run.channel.put(request);

    await expect(request.promise).resolves.toMatchObject({ skippedRunning: ['Check'] });
    expect(transport.upsert).not.toHaveBeenCalled();
    await stop(run.task);
  });
});

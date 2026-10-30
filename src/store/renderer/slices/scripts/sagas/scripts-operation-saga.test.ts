import { createCollection } from '@themislib/themis/utils/collections/collection-utils';
import { withLegacyPrincipal } from '../../../../../test/fixtures/principal-state';
import { runSaga, stdChannel, type Task } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  createScriptFixAgentRequested,
  createScriptDefinitionRequested,
  detectScriptDefinitionsRequested,
  removeScriptDefinitionsRequested,
  removeScriptDefinitionRequested,
  refreshScripts,
  deleteScriptRequested,
  startScriptRequested,
  stopScriptRequested,
  restartScriptRequested,
  getScriptDefinitionRequested,
  scriptWorkflowReleased,
  scriptsReducer,
  setScriptsData,
  updateScriptDefinitionRequested,
} from '../scripts-slice';
import { scriptsOperationSaga } from './scripts-operation-saga';
import { selectScriptWorkflowOutcome } from '../scripts-selectors';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
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

const emptyDetection = { candidates: [], packageManager: 'pnpm' as const };

type DispatchedAction = { type: string; payload?: unknown; promise?: Promise<unknown> };

function start() {
  const channel = stdChannel();
  const actions: DispatchedAction[] = [];
  const state = withLegacyPrincipal({
    scripts: scriptsReducer(undefined, { type: '@@init' }),
    workspace: { workspaces: createCollection('id', [{ id: WS, myRole: 'owner' }]) },
  });
  const dispatch = (action: DispatchedAction) => {
    state.scripts = scriptsReducer(state.scripts, action);
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

beforeEach(() => {
  transport.detectCandidates.mockResolvedValue(emptyDetection);
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

  it('rejects a bulk-removal target changed since the captured request', async () => {
    const captured = { ...definition, updatedAt: '2026-10-09T00:00:00Z' };
    transport.get.mockResolvedValueOnce({
      ...captured,
      updatedAt: '2026-10-10T00:00:00Z',
    });
    const run = start();
    const request = removeScriptDefinitionsRequested(WS, [captured], 'Unable to remove script');
    run.channel.put(request);

    await expect(request.promise).resolves.toEqual({
      removed: [],
      failed: [{ scriptId: captured.id, error: expect.any(String) }],
    });
    expect(transport.remove).not.toHaveBeenCalled();
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
    await vi.waitFor(() =>
      expect(run.actions.some((action) => action.type === 'scripts/readFinished')).toBe(true),
    );

    expect(run.actions.some((action) => action.type === createAgentFromConfigRequested.type)).toBe(
      false,
    );
    await stop(run.task);
  });

  it('drops a duplicate fix-agent request while the same script request is active', async () => {
    store.init();
    transport.get.mockResolvedValue(definition);
    const run = start();
    run.channel.put(createScriptFixAgentRequested(WS, definition.id, 'first failure'));

    await vi.waitFor(() =>
      expect(
        run.actions.some((action) => action.type === createAgentFromConfigRequested.type),
      ).toBe(true),
    );
    run.channel.put(createScriptFixAgentRequested(WS, definition.id, 'second failure'));
    await Promise.resolve();

    expect(transport.get).toHaveBeenCalledOnce();
    expect(
      run.actions.filter((action) => action.type === createAgentFromConfigRequested.type),
    ).toHaveLength(1);
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

  it('refreshes committed detection changes and reports a later write failure', async () => {
    transport.detectCandidates.mockResolvedValueOnce({
      candidates: [
        { name: 'Build', command: 'pnpm build', mode: 'command', category: 'build' },
        { name: 'Test', command: 'pnpm test', mode: 'command', category: 'test' },
      ],
      packageManager: 'pnpm',
    });
    transport.list.mockResolvedValueOnce([]);
    transport.create
      .mockResolvedValueOnce({ success: true, script: definition })
      .mockResolvedValueOnce({ success: false, error: 'storage unavailable' });
    const run = start();
    const consumer = {
      consumerId: 'detect-consumer',
      requestId: 'detect-request',
      resourceId: 'detection',
    };
    const request = detectScriptDefinitionsRequested(WS, consumer);
    run.dispatch(request);

    await expect(request.promise).rejects.toThrow('storage unavailable');
    expect(transport.create).toHaveBeenCalledTimes(2);
    expect(run.actions).toContainEqual(refreshScripts(WS));
    expect(
      selectScriptWorkflowOutcome.select(
        run.state as never,
        consumer.consumerId,
        WS,
        consumer.resourceId,
      ),
    ).toMatchObject({
      status: 'failure',
      error: 'storage unavailable',
      requestId: consumer.requestId,
    });
    expect(run.state.scripts.byWorkspaceId[WS].detectionOperation).toBeUndefined();
    await stop(run.task);
  });
});

it('guest workspace Owner can read one-off definitions without gaining script mutation authority', async () => {
  const run = start();
  run.state.principal.snapshot!.principal.isAdministrator = false;
  run.state.principal.snapshot!.capabilities.workspaceGuestRoles = true;
  run.state.workspace.workspaces.map[WS].myRole = 'owner';
  transport.get.mockResolvedValue({ ...definition, purpose: 'oneOff' });
  const read = getScriptDefinitionRequested(WS, definition.id);
  run.dispatch(read);
  await expect(read.promise).resolves.toMatchObject({ id: definition.id, purpose: 'oneOff' });
  run.dispatch(startScriptRequested(WS, definition.id));
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(transport.start).not.toHaveBeenCalled();
  await stop(run.task);
});

describe('Manager saved-script boundary', () => {
  function manager() {
    const run = start();
    run.state.principal.snapshot!.principal.isAdministrator = false;
    run.state.principal.snapshot!.capabilities.workspaceGuestRoles = true;
    run.dispatch(setScriptsData(WS, [{ ...definition, purpose: 'saved' }]));
    run.state.workspace.workspaces.map[WS].myRole = 'manager';
    run.state.workspace.workspaces.map[WS].canManage = false;
    return run;
  }
  it.each([startScriptRequested, stopScriptRequested, restartScriptRequested])(
    'runs saved-script action %s using only its ID',
    async (action) => {
      const run = manager();
      transport.start.mockResolvedValue({ success: true });
      transport.stop.mockResolvedValue({ success: true });
      transport.restart.mockResolvedValue({ success: true });
      run.dispatch(action(WS, definition.id));
      for (let i = 0; i < 20; i++) await Promise.resolve();
      expect([
        ...transport.start.mock.calls,
        ...transport.stop.mock.calls,
        ...transport.restart.mock.calls,
      ]).toEqual([[WS, definition.id]]);
      await stop(run.task);
    },
  );
  it('rejects one-off and unknown script operations and definition reads', async () => {
    const run = manager();
    run.dispatch(setScriptsData(WS, [{ ...definition, purpose: 'oneOff' }]));
    run.dispatch(startScriptRequested(WS, definition.id));
    run.dispatch(stopScriptRequested(WS, 'unknown'));
    transport.get.mockResolvedValue({ ...definition, purpose: 'oneOff' });
    const read = getScriptDefinitionRequested(WS, definition.id);
    run.dispatch(read);
    await expect(read.promise).rejects.toThrow();
    expect(transport.start).not.toHaveBeenCalled();
    expect(transport.stop).not.toHaveBeenCalled();
    await stop(run.task);
  });
  it('reads saved definitions but refuses create, edit and deletion', async () => {
    const run = manager();
    transport.get.mockResolvedValue({ ...definition, purpose: 'saved' });
    const read = getScriptDefinitionRequested(WS, definition.id);
    run.dispatch(read);
    await expect(read.promise).resolves.toMatchObject({ id: definition.id });
    const create = createScriptDefinitionRequested(WS, {
      name: 'arbitrary',
      command: 'echo changed',
      mode: 'command',
    });
    run.dispatch(create);
    await expect(create.promise).rejects.toThrow();
    const edit = updateScriptDefinitionRequested(WS, definition.id, { command: 'echo changed' });
    run.dispatch(edit);
    await expect(edit.promise).rejects.toThrow();
    run.dispatch(deleteScriptRequested(WS, definition.id));
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(transport.create).not.toHaveBeenCalled();
    expect(transport.upsert).not.toHaveBeenCalled();
    expect(transport.remove).not.toHaveBeenCalled();
    await stop(run.task);
  });
});

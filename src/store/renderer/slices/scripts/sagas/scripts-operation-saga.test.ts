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
  applyScriptDefinitionChangesRequested,
  createScriptDefinitionRequested,
  detectScriptDefinitionsRequested,
  removeScriptDefinitionRequested,
  refreshScripts,
  restoreScriptDefinitionsRequested,
  scriptWorkflowReleased,
  scriptsReducer,
  setScriptsData,
  updateScriptDefinitionRequested,
} from '../scripts-slice';
import { scriptsOperationSaga } from './scripts-operation-saga';
import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';

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

function start() {
  const channel = stdChannel();
  const actions: { type: string }[] = [];
  const state = withLegacyPrincipal({
    scripts: scriptsReducer(undefined, { type: '@@init' }),
    workspace: { workspaces: createCollection('id', [{ id: WS, myRole: 'owner' }]) },
  });
  const dispatch = (action: { type: string }) => {
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

  it('rejects an apply when the reviewed definition changed before the batch', async () => {
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

    await expect(request.promise).rejects.toThrow('pending change');
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

    await expect(request.promise).rejects.toThrow('cancelled');
    resolveUpdate({ success: true, script: definition });
    expect(transport.create).not.toHaveBeenCalled();
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

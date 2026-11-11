import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  invoke: vi.fn(),
  toastWarning: vi.fn(),
  listeners: new Map<string, (data: unknown) => void>(),
}));
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: mocks.request }));
vi.mock('$lib/components/patterns/notify', () => ({ notify: { warning: mocks.toastWarning } }));

import { createCollection, getItems } from '@themislib/themis/utils/collections/collection-utils';
import type { ConnectionRecord, ConnectionsState } from '../../connections/connections-types';
import {
  bulkTransferCancelRequested,
  bulkTransferStartRequested,
  closeBulkTransferModal,
  openBulkTransferModal,
  selectBulkTransferTarget,
  setBulkTransferArchiveSource,
  setBulkTransferRestartAgents,
  workspaceBulkTransferReducer,
} from '../workspace-bulk-transfer-slice';
import type { WorkspaceBulkTransferState } from '../workspace-bulk-transfer-types';
import { workspaceBulkTransferSaga } from './workspace-bulk-transfer-saga';

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

function connectionsState(): ConnectionsState {
  return {
    connections: createCollection<ConnectionRecord, 'id'>('id', [
      {
        id: 'conn-1',
        label: '10.0.0.2:5181',
        host: '10.0.0.2',
        port: 5181,
        fingerprint: 'AA:BB',
        isLocal: false,
        hostname: 'devbox',
      },
    ]),
    activeId: 'local',
    windowBackendId: 'local',
    status: 'idle',
    error: null,
  } as unknown as ConnectionsState;
}

const workspaces = [
  { workspaceId: 'ws-1', title: 'One' },
  { workspaceId: 'ws-2', title: 'Two' },
  { workspaceId: 'ws-3', title: 'Three' },
];

function harness(
  seed: WorkspaceBulkTransferState = workspaceBulkTransferReducer(undefined, { type: '@@init' }),
) {
  const channel = stdChannel();
  let state = seed;
  const dispatch = vi.fn((action) => {
    state = workspaceBulkTransferReducer(state, action);
    channel.put(action);
  });
  const task = runSaga(
    {
      channel,
      dispatch,
      getState: () => ({ workspaceBulkTransfer: state, connections: connectionsState() }),
    },
    workspaceBulkTransferSaga,
  );
  const put = (action: Parameters<typeof dispatch>[0]) => dispatch(action);
  return { put, task, state: () => state };
}

const items = (h: ReturnType<typeof harness>) => getItems(h.state().items);

/** Invocations of one relay channel, in call order. */
function calls(channel: string) {
  return mocks.invoke.mock.calls.filter(([name]) => name === channel).map(([, params]) => params);
}

function ready(options: { restartAgents?: boolean; archiveSource?: boolean } = {}) {
  mocks.request.mockResolvedValue({ plan: { totalSizeBytes: 100 } });
  const h = harness();
  h.put(openBulkTransferModal({ workspaces }));
  h.put(selectBulkTransferTarget('conn-1'));
  if (options.restartAgents !== undefined)
    h.put(setBulkTransferRestartAgents(options.restartAgents));
  if (options.archiveSource !== undefined)
    h.put(setBulkTransferArchiveSource(options.archiveSource));
  return h;
}

beforeEach(() => {
  vi.stubGlobal('window', {
    electronAPI: {
      invoke: mocks.invoke,
      on: vi.fn((channel: string, listener: (data: unknown) => void) => {
        mocks.listeners.set(channel, listener);
        return channel;
      }),
      offById: vi.fn(),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  mocks.request.mockReset();
  mocks.invoke.mockReset();
  mocks.toastWarning.mockReset();
  mocks.listeners.clear();
});

describe('workspaceBulkTransferSaga — size estimates', () => {
  it('fetches a plan for every selected workspace and stores each estimate', async () => {
    mocks.request.mockImplementation(async (_method: string, { workspaceId }) => {
      if (workspaceId === 'ws-2') throw new Error('plan failed');
      return { plan: { totalSizeBytes: workspaceId === 'ws-1' ? 1000 : 3000 } };
    });
    const h = harness();
    h.put(openBulkTransferModal({ workspaces }));
    await settle();

    expect(mocks.request.mock.calls.map(([method, params]) => [method, params])).toEqual([
      ['workspace.transfer.plan', { workspaceId: 'ws-1' }],
      ['workspace.transfer.plan', { workspaceId: 'ws-2' }],
      ['workspace.transfer.plan', { workspaceId: 'ws-3' }],
    ]);
    expect(items(h).map((item) => [item.sizeStatus, item.sizeBytes])).toEqual([
      ['loaded', 1000],
      ['error', null],
      ['loaded', 3000],
    ]);
    h.task.cancel();
  });
});

describe('workspaceBulkTransferSaga — run', () => {
  it('transfers then finalizes each workspace in order with the chosen options', async () => {
    mocks.invoke.mockImplementation(async (channel: string) =>
      channel === 'transfer:start'
        ? { success: true, interruptedAgents: ['agent-1'] }
        : { success: true },
    );
    const h = ready({ restartAgents: true, archiveSource: true });
    await settle();
    h.put(bulkTransferStartRequested());
    await settle();

    expect(
      mocks.invoke.mock.calls.map(([channel, params]) => [channel, params?.workspaceId]),
    ).toEqual([
      ['transfer:start', 'ws-1'],
      ['transfer:finalize', undefined],
      ['transfer:start', 'ws-2'],
      ['transfer:finalize', undefined],
      ['transfer:start', 'ws-3'],
      ['transfer:finalize', undefined],
    ]);
    expect(calls('transfer:start')[0]).toEqual({
      workspaceId: 'ws-1',
      destination: { kind: 'server', connectionId: 'conn-1' },
    });
    expect(calls('transfer:finalize')[0]).toEqual({
      archiveSource: true,
      restartAgents: true,
      finalStatusMessage: expect.stringContaining('devbox'),
    });
    expect(h.state().step).toBe('result');
    expect(items(h).map((item) => item.status)).toEqual(['done', 'done', 'done']);
    h.task.cancel();
  });

  it('keeps the source in place when archiving is off', async () => {
    mocks.invoke.mockResolvedValue({ success: true });
    const h = ready({ restartAgents: false, archiveSource: false });
    await settle();
    h.put(bulkTransferStartRequested());
    await settle();

    expect(calls('transfer:finalize')[0]).toEqual({ archiveSource: false, restartAgents: false });
    h.task.cancel();
  });

  it('marks a failed workspace and continues with the next one', async () => {
    mocks.invoke.mockImplementation(async (channel: string, params?: { workspaceId?: string }) => {
      if (channel === 'transfer:start' && params?.workspaceId === 'ws-1')
        return { success: false, error: 'destination unavailable', failurePhase: 'preflight' };
      if (channel === 'transfer:finalize' && calls('transfer:start').length === 2)
        return { success: false, error: 'source busy' };
      return { success: true };
    });
    const h = ready();
    await settle();
    h.put(bulkTransferStartRequested());
    await settle();

    expect(calls('transfer:start').map((params) => params.workspaceId)).toEqual([
      'ws-1',
      'ws-2',
      'ws-3',
    ]);
    expect(calls('transfer:finalize')).toHaveLength(2);
    expect(items(h).map((item) => [item.status, item.error])).toEqual([
      ['failed', 'destination unavailable'],
      ['failed', expect.stringContaining('source busy')],
      ['done', null],
    ]);
    expect(h.state().step).toBe('result');
    h.task.cancel();
  });

  it('cancels the running transfer and skips the rest', async () => {
    let resolveStart: (value: unknown) => void = () => {};
    mocks.invoke.mockImplementation((channel: string) => {
      if (channel === 'transfer:start') return new Promise((resolve) => (resolveStart = resolve));
      return Promise.resolve({ success: true });
    });
    const h = ready();
    await settle();
    h.put(bulkTransferStartRequested());
    await settle();
    expect(items(h)[0]?.status).toBe('running');

    h.put(bulkTransferCancelRequested());
    await settle();
    resolveStart({ success: false, error: 'cancelled' });
    await settle();

    expect(calls('transfer:cancel')).toHaveLength(1);
    expect(calls('transfer:start')).toHaveLength(1);
    expect(calls('transfer:finalize')).toHaveLength(0);
    expect(items(h).map((item) => item.status)).toEqual(['skipped', 'skipped', 'skipped']);
    expect(h.state().step).toBe('result');
    h.task.cancel();
  });

  it('stops after the current finalize when cancel arrives while finalizing', async () => {
    let resolveFinalize: (value: unknown) => void = () => {};
    mocks.invoke.mockImplementation((channel: string) => {
      if (channel === 'transfer:finalize')
        return new Promise((resolve) => (resolveFinalize = resolve));
      return Promise.resolve({ success: true });
    });
    const h = ready();
    await settle();
    h.put(bulkTransferStartRequested());
    await settle();
    h.put(bulkTransferCancelRequested());
    await settle();
    resolveFinalize({ success: true });
    await settle();

    expect(calls('transfer:cancel')).toHaveLength(0);
    expect(items(h).map((item) => item.status)).toEqual(['done', 'skipped', 'skipped']);
    h.task.cancel();
  });

  it('tracks relay progress for the running workspace only', async () => {
    mocks.invoke.mockImplementation((channel: string) =>
      channel === 'transfer:start' ? new Promise(() => {}) : Promise.resolve({ success: true }),
    );
    const h = ready();
    await settle();
    h.put(bulkTransferStartRequested());
    await settle();

    mocks.listeners.get('transfer:progress')?.({
      workspaceId: 'ws-2',
      phase: 'relaying',
      bytesDown: 9,
      bytesUp: 9,
      chunksDone: 1,
    });
    mocks.listeners.get('transfer:progress')?.({
      workspaceId: 'ws-1',
      phase: 'relaying',
      bytesTotal: 100,
      bytesDown: 50,
      bytesUp: 0,
      chunksDone: 1,
    });
    await settle();

    expect(h.state().progress).toMatchObject({ phase: 'relaying', bytesDown: 50 });
    h.task.cancel();
  });

  it('warns once with the total when the destination could not resume some agents', async () => {
    mocks.invoke.mockImplementation(async (channel: string) =>
      channel === 'transfer:finalize' ? { success: true, resumeFailed: ['a'] } : { success: true },
    );
    const h = ready({ restartAgents: true });
    await settle();
    h.put(bulkTransferStartRequested());
    await settle();

    await vi.waitFor(() => expect(mocks.toastWarning).toHaveBeenCalledTimes(1));
    expect(mocks.toastWarning.mock.calls[0]?.[0]).toContain('3');
    h.task.cancel();
  });

  it('cleans up the source after a failed finalize before the next workspace starts', async () => {
    mocks.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'transfer:finalize' && calls('transfer:finalize').length === 1)
        return { success: false, error: 'source busy' };
      return { success: true };
    });
    const h = ready();
    await settle();
    h.put(bulkTransferStartRequested());
    await settle();

    expect(mocks.invoke.mock.calls.slice(0, 4).map(([channel]) => channel)).toEqual([
      'transfer:start',
      'transfer:finalize',
      'transfer:cancel',
      'transfer:start',
    ]);
    expect(items(h)[0]?.status).toBe('failed');
    h.task.cancel();
  });

  it('lets a transfer that is importing on the destination finish when Stop arrives', async () => {
    let resolveStart: (value: unknown) => void = () => {};
    mocks.invoke.mockImplementation((channel: string) => {
      if (channel === 'transfer:start') return new Promise((resolve) => (resolveStart = resolve));
      return Promise.resolve({ success: true });
    });
    const h = ready();
    await settle();
    h.put(bulkTransferStartRequested());
    await settle();
    mocks.listeners.get('transfer:progress')?.({
      workspaceId: 'ws-1',
      phase: 'committing',
      bytesTotal: 10,
      bytesDown: 10,
      bytesUp: 10,
      chunksDone: 1,
    });
    await settle();

    h.put(bulkTransferCancelRequested());
    await settle();
    resolveStart({ success: true });
    await settle();

    expect(calls('transfer:cancel')).toHaveLength(0);
    expect(calls('transfer:finalize')).toHaveLength(1);
    expect(items(h).map((item) => item.status)).toEqual(['done', 'skipped', 'skipped']);
    h.task.cancel();
  });

  it('reports a stopped workspace whose import still landed as failed, not skipped', async () => {
    let resolveStart: (value: unknown) => void = () => {};
    mocks.invoke.mockImplementation((channel: string) => {
      if (channel === 'transfer:start') return new Promise((resolve) => (resolveStart = resolve));
      return Promise.resolve({ success: true });
    });
    const h = ready();
    await settle();
    h.put(bulkTransferStartRequested());
    await settle();
    h.put(bulkTransferCancelRequested());
    await settle();
    resolveStart({ success: true });
    await settle();

    expect(calls('transfer:cancel')).toHaveLength(1);
    expect(calls('transfer:finalize')).toHaveLength(0);
    expect(items(h).map((item) => item.status)).toEqual(['failed', 'skipped', 'skipped']);
    h.task.cancel();
  });

  it('treats a start the relay reports as cancelled as skipped and stops the run', async () => {
    mocks.invoke.mockImplementation(async (channel: string) =>
      channel === 'transfer:start' ? { success: false, canceled: true } : { success: true },
    );
    const h = ready();
    await settle();
    h.put(bulkTransferStartRequested());
    await settle();

    expect(calls('transfer:start')).toHaveLength(1);
    expect(items(h).map((item) => item.status)).toEqual(['skipped', 'skipped', 'skipped']);
    h.task.cancel();
  });

  it('keeps loading size estimates when a close is ignored during the run', async () => {
    const pending: Array<() => void> = [];
    mocks.request.mockImplementation(
      () =>
        new Promise((resolve) => pending.push(() => resolve({ plan: { totalSizeBytes: 100 } }))),
    );
    mocks.invoke.mockImplementation(() => new Promise(() => {}));
    const h = harness();
    h.put(openBulkTransferModal({ workspaces }));
    h.put(selectBulkTransferTarget('conn-1'));
    h.put(bulkTransferStartRequested());
    await settle();
    h.put(closeBulkTransferModal());
    for (const resolve of pending.splice(0)) resolve();
    await settle();
    for (const resolve of pending.splice(0)) resolve();
    await settle();

    expect(h.state().open).toBe(true);
    expect(items(h).map((item) => item.sizeStatus)).toEqual(['loaded', 'loaded', 'loaded']);
    h.task.cancel();
  });
});

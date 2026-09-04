import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { m } from '$shared/paraglide/messages.js';

const mocks = vi.hoisted(() => ({
  getMcpServers: vi.fn(),
  setMcpServers: vi.fn(),
  getMcpServerStatuses: vi.fn(),
  getWorkspaceDisabledMcpServerNames: vi.fn(),
  toggleWorkspaceMcpServer: vi.fn(),
}));
vi.mock('$lib/client', () => ({
  appClient: {
    settings: {
      getMcpServers: mocks.getMcpServers,
      setMcpServers: mocks.setMcpServers,
      getMcpServerStatuses: mocks.getMcpServerStatuses,
      getWorkspaceDisabledMcpServerNames: mocks.getWorkspaceDisabledMcpServerNames,
      toggleWorkspaceMcpServer: mocks.toggleWorkspaceMcpServer,
    },
  },
}));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ warn: vi.fn(), error: vi.fn() }),
}));

import {
  addServer,
  hydrateWorkspaceMcpDisabled,
  importFromJson,
  initialState,
  loadServers,
  mcpSettingsReducer,
  removeServer,
  restartServer,
  saveAdvancedJson,
  setServerErrorMessage,
  setServers,
  setWorkspaceMcpServerDisabled,
  toggleServer,
  toggleWorkspaceMcpServer,
  updateServer,
} from '../mcp-settings-slice';
import { ADVANCED_SAVED_RESET_MS, mcpSettingsSaga } from './mcp-settings-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function harness(seed = initialState) {
  const channel = stdChannel();
  let state = seed;
  const dispatched: unknown[] = [];
  const dispatch = (action: never) => {
    dispatched.push(action);
    state = mcpSettingsReducer(state, action);
    return action;
  };
  const task = runSaga(
    { channel, dispatch, getState: () => ({ mcpSettings: state }) },
    mcpSettingsSaga,
  );
  return { channel, dispatched, state: () => state, task };
}

describe('mcpSettingsSaga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getMcpServers.mockResolvedValue([]);
    mocks.getMcpServerStatuses.mockResolvedValue([]);
  });
  afterEach(() => vi.useRealTimers());

  it('takes the latest load and strips non-contract wire fields', async () => {
    let resolveStale!: (value: unknown[]) => void;
    mocks.getMcpServers
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveStale = resolve;
        }),
      )
      .mockResolvedValueOnce([
        {
          id: 'server-2',
          name: 'beta',
          type: 'http',
          url: 'https://mcp.test',
          headers: { Authorization: 'test' },
          disabled: true,
          runtimeStatus: 'wire-only',
        },
      ]);
    const run = harness();
    run.channel.put(loadServers());
    await settle();
    run.channel.put(loadServers());
    await settle();
    resolveStale([{ id: 'server-1', name: 'stale', type: 'stdio', command: 'stale' }]);
    await settle();

    expect(mocks.getMcpServers.mock.calls).toEqual([[], []]);
    expect(run.state().servers).toEqual([
      {
        id: 'server-2',
        name: 'beta',
        type: 'http',
        url: 'https://mcp.test',
        disabled: true,
      },
    ]);
    expect(run.state().statusMap).toEqual({ beta: 'disabled' });
    expect(run.state().disabledServers).toEqual({ beta: true });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('excludes wire credentials from every dispatched load result action', async () => {
    mocks.getMcpServers.mockResolvedValue([
      {
        name: 'secure',
        type: 'http',
        url: 'https://secure.test',
        env: { API_KEY: 'secret' },
        headers: { Authorization: 'Bearer secret', Cookie: 'secret' },
      },
    ]);
    const run = harness();
    run.channel.put(loadServers());
    await settle();

    expect(run.dispatched).toEqual([
      { type: 'mcpSettings/setLoading', payload: [true] },
      { type: 'mcpSettings/setError', payload: [null] },
      {
        type: 'mcpSettings/setServers',
        payload: [
          [
            {
              name: 'secure',
              type: 'http',
              url: 'https://secure.test',
            },
          ],
        ],
      },
      { type: 'mcpSettings/clearAllErrorMessages', payload: [] },
      { type: 'mcpSettings/setDisabledServers', payload: [{}] },
      { type: 'mcpSettings/bulkSetServerStatus', payload: [{ secure: 'configured' }] },
      { type: 'mcpSettings/setLoading', payload: [false] },
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('overlays daemon-reported statuses on load for enabled servers with daemon ids', async () => {
    mocks.getMcpServers.mockResolvedValue([
      { id: 'srv-up', name: 'up', type: 'http', url: 'https://up.test' },
      { id: 'srv-down', name: 'down', type: 'http', url: 'https://down.test' },
      { id: 'srv-off', name: 'off', type: 'http', url: 'https://off.test', disabled: true },
      { name: 'no-id', type: 'stdio', command: 'node' },
    ]);
    // PROTOCOL §5.22 McpServerStatus shapes.
    mocks.getMcpServerStatuses.mockResolvedValue([
      { serverId: 'srv-up', state: 'running', toolCount: 7, startedAt: 1750000000000 },
      { serverId: 'srv-down', state: 'error', lastError: 'unreachable from daemon host' },
    ]);
    const run = harness();
    run.channel.put(loadServers());
    await settle();

    expect(mocks.getMcpServerStatuses.mock.calls).toEqual([[['srv-up', 'srv-down']]]);
    expect(run.state().statusMap).toEqual({
      up: 'connected',
      down: 'error',
      off: 'disabled',
      'no-id': 'configured',
    });
    expect(run.state().errorMessages).toEqual({ down: 'unreachable from daemon host' });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('keeps config-derived statuses when the daemon status fetch fails', async () => {
    mocks.getMcpServers.mockResolvedValue([
      { id: 'srv-up', name: 'up', type: 'http', url: 'https://up.test' },
    ]);
    mocks.getMcpServerStatuses.mockRejectedValue(new Error('wire down'));
    const run = harness();
    run.channel.put(loadServers());
    await settle();

    expect(run.state().statusMap).toEqual({ up: 'configured' });
    expect(run.state().error).toBeNull();
    expect(run.state().loading).toBe(false);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('refreshes daemon ids and overlays runtime status after a successful add persist', async () => {
    mocks.getMcpServers.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'srv-local',
        name: 'local',
        type: 'stdio',
        command: 'node',
        env: { MODE: 'test' },
      },
    ]);
    mocks.setMcpServers.mockResolvedValue({ success: true });
    // PROTOCOL §5.22 McpServerStatus shape.
    mocks.getMcpServerStatuses.mockResolvedValue([
      { serverId: 'srv-local', state: 'running', toolCount: 3, startedAt: 1750000000000 },
    ]);
    const run = harness();
    run.channel.put(addServer({ name: 'local', type: 'stdio', command: 'node' }));
    await settle();

    expect(mocks.getMcpServers.mock.calls).toEqual([[], []]);
    // Daemon id merged into state by name (credentials still stripped) so the
    // status overlay and live mcp.servers:status-changed events can correlate.
    expect(run.state().servers).toEqual([
      { id: 'srv-local', name: 'local', type: 'stdio', command: 'node' },
    ]);
    expect(mocks.getMcpServerStatuses.mock.calls).toEqual([[['srv-local']]]);
    expect(run.state().statusMap).toEqual({ local: 'connected' });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('refreshes daemon ids and overlays runtime status after a successful advanced save', async () => {
    mocks.setMcpServers.mockResolvedValue({ success: true });
    mocks.getMcpServers.mockResolvedValue([
      { id: 'srv-remote', name: 'remote', type: 'http', url: 'https://remote.test' },
    ]);
    mocks.getMcpServerStatuses.mockResolvedValue([
      { serverId: 'srv-remote', state: 'error', lastError: 'unreachable from daemon host' },
    ]);
    const run = harness();
    run.channel.put(
      saveAdvancedJson(
        JSON.stringify({
          mcpServers: [{ name: 'remote', type: 'http', url: 'https://remote.test' }],
        }),
      ),
    );
    await settle();

    expect(mocks.getMcpServers.mock.calls).toEqual([[]]);
    expect(run.state().servers).toEqual([
      { id: 'srv-remote', name: 'remote', type: 'http', url: 'https://remote.test' },
    ]);
    expect(mocks.getMcpServerStatuses.mock.calls).toEqual([[['srv-remote']]]);
    expect(run.state().statusMap).toEqual({ remote: 'error' });
    expect(run.state().errorMessages).toEqual({ remote: 'unreachable from daemon host' });
    expect(run.state().advancedSaveStatus).toEqual('saved');
    run.task.cancel();
    await run.task.toPromise();
  });

  it('does not refresh daemon ids or fetch statuses when persist fails', async () => {
    mocks.setMcpServers.mockResolvedValue({ success: false, error: 'write rejected' });
    const run = harness();
    run.channel.put(addServer({ name: 'local', type: 'stdio', command: 'node' }));
    await settle();

    expect(mocks.getMcpServers.mock.calls).toEqual([[]]);
    expect(mocks.getMcpServerStatuses.mock.calls).toEqual([]);
    expect(run.state().servers).toEqual([{ name: 'local', type: 'stdio', command: 'node' }]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('keeps the optimistic list and no error when the post-save id refresh fails', async () => {
    mocks.getMcpServers.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('refresh down'));
    mocks.setMcpServers.mockResolvedValue({ success: true });
    const run = harness();
    run.channel.put(addServer({ name: 'local', type: 'stdio', command: 'node' }));
    await settle();

    expect(run.state().servers).toEqual([{ name: 'local', type: 'stdio', command: 'node' }]);
    expect(run.state().error).toBeNull();
    expect(mocks.getMcpServerStatuses.mock.calls).toEqual([]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('clears a stale error message when the post-save overlay reports a non-error status', async () => {
    const seeded = mcpSettingsReducer(
      mcpSettingsReducer(
        initialState,
        setServers([{ id: 'srv-a', name: 'alpha', type: 'http', url: 'https://alpha.test' }]),
      ),
      setServerErrorMessage('alpha', 'old boom'),
    );
    mocks.getMcpServers.mockResolvedValue([
      { id: 'srv-a', name: 'alpha', type: 'http', url: 'https://alpha.test' },
    ]);
    mocks.setMcpServers.mockResolvedValue({ success: true });
    mocks.getMcpServerStatuses.mockResolvedValue([
      { serverId: 'srv-a', state: 'running', toolCount: 2 },
    ]);
    const run = harness(seeded);
    run.channel.put(
      updateServer('alpha', {
        name: 'alpha',
        type: 'http',
        url: 'https://alpha.test',
      }),
    );
    await settle();

    expect(run.state().statusMap).toEqual({ alpha: 'connected' });
    expect(run.state().errorMessages).toEqual({});
    run.task.cancel();
    await run.task.toPromise();
  });

  it('drops a stale forked status result when the daemon id changed mid-flight', async () => {
    let resolveStale!: (value: unknown[]) => void;
    mocks.getMcpServers
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'srv-old', name: 'local', type: 'stdio', command: 'node' }])
      .mockResolvedValueOnce([{ id: 'srv-old', name: 'local', type: 'stdio', command: 'node' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ id: 'srv-new', name: 'local', type: 'stdio', command: 'node' }]);
    mocks.setMcpServers.mockResolvedValue({ success: true });
    mocks.getMcpServerStatuses
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveStale = resolve;
        }),
      )
      .mockResolvedValueOnce([{ serverId: 'srv-new', state: 'running', toolCount: 1 }]);
    const run = harness();
    run.channel.put(addServer({ name: 'local', type: 'stdio', command: 'node' }));
    await settle();
    run.channel.put(removeServer('local'));
    await settle();
    run.channel.put(addServer({ name: 'local', type: 'stdio', command: 'node' }));
    await settle();
    // The re-added card now carries srv-new; the first fan-out (for srv-old)
    // resolves late with an error that must not be applied to the new card.
    resolveStale([{ serverId: 'srv-old', state: 'error', lastError: 'stale boom' }]);
    await settle();

    expect(mocks.getMcpServerStatuses.mock.calls).toEqual([[['srv-old']], [['srv-new']]]);
    expect(run.state().servers).toEqual([
      { id: 'srv-new', name: 'local', type: 'stdio', command: 'node' },
    ]);
    expect(run.state().statusMap.local).toEqual('connected');
    expect(run.state().errorMessages).toEqual({});
    run.task.cancel();
    await run.task.toPromise();
  });

  it('persists exact add/import requests and restarts only local status', async () => {
    mocks.getMcpServers.mockResolvedValueOnce([]).mockResolvedValue([
      {
        name: 'local',
        type: 'stdio',
        command: 'node',
        args: ['server.js'],
        env: { MODE: 'test' },
      },
    ]);
    mocks.setMcpServers.mockResolvedValue({ success: true });
    const run = harness();
    run.channel.put(
      addServer({
        name: 'local',
        type: 'stdio',
        command: 'node',
        args: ['server.js'],
        env: { MODE: 'test' },
        wireOnly: 'drop',
      } as never),
    );
    await settle();
    run.channel.put(
      importFromJson(
        JSON.stringify({
          mcpServers: [
            {
              name: 'remote',
              type: 'http',
              url: 'https://remote.test',
              headers: { Authorization: 'test' },
              runtimeStatus: 'drop',
            },
          ],
        }),
      ),
    );
    await settle();
    run.channel.put(restartServer('remote'));
    await settle();

    expect(mocks.setMcpServers.mock.calls).toEqual([
      [
        [
          {
            name: 'local',
            type: 'stdio',
            command: 'node',
            args: ['server.js'],
            env: { MODE: 'test' },
          },
        ],
      ],
      [
        [
          {
            name: 'local',
            type: 'stdio',
            command: 'node',
            args: ['server.js'],
            env: { MODE: 'test' },
          },
          {
            name: 'remote',
            type: 'http',
            url: 'https://remote.test',
            headers: { Authorization: 'test' },
          },
        ],
      ],
    ]);
    // Two reads per persist: the pre-save credential read plus the post-save
    // daemon-id refresh.
    expect(mocks.getMcpServers.mock.calls).toEqual([[], [], [], []]);
    expect(run.state().servers).toEqual([
      { name: 'local', type: 'stdio', command: 'node', args: ['server.js'] },
      { name: 'remote', type: 'http', url: 'https://remote.test' },
    ]);
    expect(run.state().statusMap).toEqual({ local: 'configured', remote: 'configured' });
    expect(run.state().lastImportedCount).toEqual(1);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('surfaces the exact persistence failure after an optimistic add', async () => {
    mocks.setMcpServers.mockResolvedValue({ success: false, error: 'write rejected' });
    const run = harness();
    run.channel.put(
      addServer({
        name: 'local',
        type: 'stdio',
        command: 'node',
        env: { TOKEN: 'secret' },
      }),
    );
    await settle();

    expect(mocks.setMcpServers.mock.calls).toEqual([
      [
        [
          {
            name: 'local',
            type: 'stdio',
            command: 'node',
            env: { TOKEN: 'secret' },
          },
        ],
      ],
    ]);
    expect(run.state().servers).toEqual([{ name: 'local', type: 'stdio', command: 'node' }]);
    expect(run.state().error).toEqual('write rejected');
    expect(run.dispatched.at(-1)).toEqual({
      type: 'mcpSettings/setError',
      payload: ['write rejected'],
    });
    run.task.cancel();
    await run.task.toPromise();
  });

  it('keeps advanced-save secrets off Redux and resets saved status after the delay', async () => {
    vi.useFakeTimers();
    mocks.setMcpServers.mockResolvedValue({ success: true });
    const run = harness();
    run.channel.put(
      saveAdvancedJson(
        JSON.stringify({
          mcpServers: [
            {
              name: 'remote',
              type: 'http',
              url: 'https://remote.test',
              headers: { Authorization: 'Bearer secret' },
              env: { API_KEY: 'secret' },
            },
          ],
        }),
      ),
    );
    await settle();

    expect(mocks.setMcpServers.mock.calls).toEqual([
      [
        [
          {
            name: 'remote',
            type: 'http',
            url: 'https://remote.test',
            headers: { Authorization: 'Bearer secret' },
            env: { API_KEY: 'secret' },
          },
        ],
      ],
    ]);
    expect(run.state().servers).toEqual([
      {
        name: 'remote',
        type: 'http',
        url: 'https://remote.test',
      },
    ]);
    expect(run.state().advancedSaveStatus).toEqual('saved');
    await vi.advanceTimersByTimeAsync(ADVANCED_SAVED_RESET_MS - 1);
    expect(run.state().advancedSaveStatus).toEqual('saved');
    await vi.advanceTimersByTimeAsync(1);
    expect(run.state().advancedSaveStatus).toEqual('idle');
    run.task.cancel();
    await run.task.toPromise();
  });

  it('does not let an older cleanup reset a newer in-flight save', async () => {
    vi.useFakeTimers();
    let resolveSecond!: (value: { success: true }) => void;
    mocks.setMcpServers.mockResolvedValueOnce({ success: true }).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSecond = resolve;
      }),
    );
    const run = harness();
    run.channel.put(saveAdvancedJson(JSON.stringify({ mcpServers: [] })));
    await settle();
    await vi.advanceTimersByTimeAsync(ADVANCED_SAVED_RESET_MS / 2);
    run.channel.put(saveAdvancedJson(JSON.stringify({ mcpServers: [] })));
    await settle();
    await vi.advanceTimersByTimeAsync(ADVANCED_SAVED_RESET_MS / 2);
    expect(run.state().advancedSaveStatus).toEqual('saving');
    resolveSecond({ success: true });
    await settle();
    await vi.advanceTimersByTimeAsync(ADVANCED_SAVED_RESET_MS);
    expect(run.state().advancedSaveStatus).toEqual('idle');
    run.task.cancel();
    await run.task.toPromise();
  });

  it('removes a server with the exact canonical request and result action', async () => {
    const servers = [
      { name: 'keep', type: 'stdio' as const, command: 'keep' },
      { name: 'drop', type: 'http' as const, url: 'https://drop.test' },
    ];
    mocks.getMcpServers.mockResolvedValue([
      { ...servers[0], env: { TOKEN: '[REDACTED]' } },
      { ...servers[1], headers: { Authorization: '[REDACTED]' } },
    ]);
    mocks.setMcpServers.mockResolvedValue({ success: true });
    const run = harness(mcpSettingsReducer(initialState, setServers(servers)));
    run.channel.put(removeServer('drop'));
    await settle();

    // Pre-save credential read plus the post-save daemon-id refresh.
    expect(mocks.getMcpServers.mock.calls).toEqual([[], []]);
    expect(mocks.setMcpServers.mock.calls).toEqual([
      [
        [
          {
            name: 'keep',
            type: 'stdio',
            command: 'keep',
            env: { TOKEN: '[REDACTED]' },
          },
        ],
      ],
    ]);
    expect(run.dispatched).toEqual([
      { type: 'mcpSettings/removeServerFromState', payload: ['drop'] },
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('updates a server with the exact request and preserves only main-owned redacted credentials', async () => {
    const original = { name: 'remote', type: 'http' as const, url: 'https://old.test' };
    mocks.getMcpServers.mockResolvedValue([
      {
        ...original,
        headers: { Authorization: '[REDACTED]' },
      },
    ]);
    mocks.setMcpServers.mockResolvedValue({ success: true });
    const run = harness(mcpSettingsReducer(initialState, setServers([original])));
    run.channel.put(
      updateServer('remote', {
        name: 'remote',
        type: 'http',
        url: 'https://new.test',
      }),
    );
    await settle();

    expect(mocks.setMcpServers.mock.calls).toEqual([
      [
        [
          {
            name: 'remote',
            type: 'http',
            url: 'https://new.test',
            headers: { Authorization: '[REDACTED]' },
          },
        ],
      ],
    ]);
    expect(run.dispatched).toEqual([
      { type: 'mcpSettings/setError', payload: [null] },
      {
        type: 'mcpSettings/setServers',
        payload: [
          [
            {
              name: 'remote',
              type: 'http',
              url: 'https://new.test',
            },
          ],
        ],
      },
      { type: 'mcpSettings/setServerStatus', payload: ['remote', 'configured'] },
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('toggles a server with the exact disabled request and result actions', async () => {
    const remote = { name: 'remote', type: 'http' as const, url: 'https://remote.test' };
    mocks.getMcpServers.mockResolvedValue([
      {
        ...remote,
        headers: { Authorization: '[REDACTED]' },
      },
    ]);
    mocks.setMcpServers.mockResolvedValue({ success: true });
    const run = harness(mcpSettingsReducer(initialState, setServers([remote])));
    run.channel.put(toggleServer('remote'));
    await settle();

    expect(mocks.setMcpServers.mock.calls).toEqual([
      [
        [
          {
            name: 'remote',
            type: 'http',
            url: 'https://remote.test',
            headers: { Authorization: '[REDACTED]' },
            disabled: true,
          },
        ],
      ],
    ]);
    expect(run.dispatched).toEqual([
      { type: 'mcpSettings/toggleServerDisabled', payload: ['remote'] },
      { type: 'mcpSettings/setServerStatus', payload: ['remote', 'disabled'] },
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('updates restart status directly without an unsupported wire request', async () => {
    const remote = { name: 'remote', type: 'http' as const, url: 'https://remote.test' };
    const run = harness({
      ...initialState,
      servers: [remote],
      errorMessages: { remote: 'connection failed' },
    });
    run.channel.put(restartServer('remote'));
    await settle();

    expect(mocks.getMcpServers.mock.calls).toEqual([]);
    expect(mocks.setMcpServers.mock.calls).toEqual([]);
    expect(run.dispatched).toEqual([
      { type: 'mcpSettings/clearServerErrorMessage', payload: ['remote'] },
      { type: 'mcpSettings/setServerStatus', payload: ['remote', 'configured'] },
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('ignores an unknown restart target without wire calls or result actions', async () => {
    const run = harness();
    run.channel.put(restartServer('missing'));
    await settle();

    expect(mocks.getMcpServers.mock.calls).toEqual([]);
    expect(mocks.setMcpServers.mock.calls).toEqual([]);
    expect(run.dispatched).toEqual([]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('dispatches exact failures for load, remove, update, import, toggle, and advanced save', async () => {
    mocks.getMcpServers.mockRejectedValueOnce(new Error('load rejected'));
    const loadRun = harness();
    loadRun.channel.put(loadServers());
    await settle();
    expect(loadRun.dispatched).toEqual([
      { type: 'mcpSettings/setLoading', payload: [true] },
      { type: 'mcpSettings/setError', payload: [null] },
      { type: 'mcpSettings/setError', payload: ['load rejected'] },
      { type: 'mcpSettings/setLoading', payload: [false] },
    ]);
    loadRun.task.cancel();
    await loadRun.task.toPromise();

    const remote = { name: 'remote', type: 'http' as const, url: 'https://remote.test' };
    mocks.getMcpServers.mockResolvedValueOnce([remote]);
    mocks.setMcpServers.mockResolvedValueOnce({ success: false, error: 'remove rejected' });
    const removeRun = harness(mcpSettingsReducer(initialState, setServers([remote])));
    removeRun.channel.put(removeServer('remote'));
    await settle();
    expect(removeRun.dispatched).toEqual([
      { type: 'mcpSettings/removeServerFromState', payload: ['remote'] },
      { type: 'mcpSettings/setError', payload: ['remove rejected'] },
    ]);
    removeRun.task.cancel();
    await removeRun.task.toPromise();

    const duplicate = { name: 'duplicate', type: 'stdio' as const, command: 'node' };
    const updateRun = harness(mcpSettingsReducer(initialState, setServers([remote, duplicate])));
    updateRun.channel.put(updateServer('remote', { ...remote, name: 'duplicate' }));
    await settle();
    expect(updateRun.dispatched).toEqual([
      { type: 'mcpSettings/setError', payload: [null] },
      {
        type: 'mcpSettings/setError',
        payload: [m.mcp_management_serverNameExists_error({ name: 'duplicate' })],
      },
    ]);
    updateRun.task.cancel();
    await updateRun.task.toPromise();

    const importRun = harness();
    importRun.channel.put(importFromJson('not-json'));
    await settle();
    expect(importRun.dispatched).toEqual([
      { type: 'mcpSettings/setError', payload: [null] },
      {
        type: 'mcpSettings/setError',
        payload: ['Unexpected token \'o\', "not-json" is not valid JSON'],
      },
    ]);
    importRun.task.cancel();
    await importRun.task.toPromise();

    mocks.getMcpServers.mockResolvedValueOnce([remote]);
    mocks.setMcpServers.mockResolvedValueOnce({ success: false, error: 'toggle rejected' });
    const toggleRun = harness(mcpSettingsReducer(initialState, setServers([remote])));
    toggleRun.channel.put(toggleServer('remote'));
    await settle();
    expect(toggleRun.dispatched).toEqual([
      { type: 'mcpSettings/toggleServerDisabled', payload: ['remote'] },
      { type: 'mcpSettings/setServerStatus', payload: ['remote', 'disabled'] },
      { type: 'mcpSettings/setError', payload: ['toggle rejected'] },
    ]);
    toggleRun.task.cancel();
    await toggleRun.task.toPromise();

    mocks.setMcpServers.mockResolvedValueOnce({ success: false, error: 'advanced rejected' });
    const advancedRun = harness();
    advancedRun.channel.put(saveAdvancedJson(JSON.stringify({ mcpServers: [remote] })));
    await settle();
    expect(advancedRun.dispatched).toEqual([
      { type: 'mcpSettings/setAdvancedSaveStatus', payload: ['saving'] },
      { type: 'mcpSettings/setServers', payload: [[remote]] },
      { type: 'mcpSettings/setDisabledServers', payload: [{}] },
      { type: 'mcpSettings/bulkSetServerStatus', payload: [{ remote: 'configured' }] },
      { type: 'mcpSettings/setAdvancedSaveStatus', payload: ['error', 'advanced rejected'] },
    ]);
    advancedRun.task.cancel();
    await advancedRun.task.toPromise();
  });

  it('workspace-toggles a server via the daemon and stores the confirmed disabled state', async () => {
    const remote = {
      id: 'srv-remote',
      name: 'remote',
      type: 'http' as const,
      url: 'https://remote.test',
    };
    mocks.toggleWorkspaceMcpServer.mockResolvedValue({ success: true, workspaceDisabled: true });
    const run = harness(mcpSettingsReducer(initialState, setServers([remote])));
    run.channel.put(toggleWorkspaceMcpServer('ws-1', 'remote', false));
    await settle();

    expect(mocks.toggleWorkspaceMcpServer.mock.calls).toEqual([['ws-1', 'srv-remote', false]]);
    expect(run.dispatched).toEqual([
      { type: 'mcpSettings/setWorkspaceMcpServerDisabled', payload: ['ws-1', 'remote', true] },
    ]);
    expect(run.state().byWorkspaceId['ws-1'].disabledServers).toEqual({ remote: true });
    expect(run.state().disabledServers).toEqual({});
    run.task.cancel();
    await run.task.toPromise();
  });

  it('workspace-toggle re-enable clears the disabled marker from the confirmed result', async () => {
    const remote = {
      id: 'srv-remote',
      name: 'remote',
      type: 'http' as const,
      url: 'https://remote.test',
    };
    mocks.toggleWorkspaceMcpServer.mockResolvedValue({ success: true, workspaceDisabled: false });
    const seed = mcpSettingsReducer(
      mcpSettingsReducer(initialState, setServers([remote])),
      setWorkspaceMcpServerDisabled('ws-1', 'remote', true),
    );
    const run = harness(seed);
    run.channel.put(toggleWorkspaceMcpServer('ws-1', 'remote', true));
    await settle();

    expect(mocks.toggleWorkspaceMcpServer.mock.calls).toEqual([['ws-1', 'srv-remote', true]]);
    expect(run.state().byWorkspaceId['ws-1'].disabledServers).toEqual({});
    run.task.cancel();
    await run.task.toPromise();
  });

  it('workspace-toggle failure re-hydrates the scoped list instead of writing optimistically', async () => {
    const remote = {
      id: 'srv-remote',
      name: 'remote',
      type: 'http' as const,
      url: 'https://remote.test',
    };
    mocks.toggleWorkspaceMcpServer.mockResolvedValue({ success: false, error: 'not-found' });
    mocks.getWorkspaceDisabledMcpServerNames.mockResolvedValue([]);
    const run = harness(mcpSettingsReducer(initialState, setServers([remote])));
    run.channel.put(toggleWorkspaceMcpServer('ws-1', 'remote', false));
    await settle();

    expect(mocks.getWorkspaceDisabledMcpServerNames.mock.calls).toEqual([['ws-1']]);
    expect(run.dispatched).toEqual([
      { type: 'mcpSettings/setWorkspaceDisabledMcpServers', payload: ['ws-1', {}] },
    ]);
    expect(run.state().byWorkspaceId['ws-1']?.disabledServers ?? {}).toEqual({});
    run.task.cancel();
    await run.task.toPromise();
  });

  it('workspace-toggle success without workspaceDisabled re-hydrates instead of inferring from the request', async () => {
    const remote = {
      id: 'srv-remote',
      name: 'remote',
      type: 'http' as const,
      url: 'https://remote.test',
    };
    mocks.toggleWorkspaceMcpServer.mockResolvedValue({ success: true });
    mocks.getWorkspaceDisabledMcpServerNames.mockResolvedValue(['remote']);
    const run = harness(mcpSettingsReducer(initialState, setServers([remote])));
    run.channel.put(toggleWorkspaceMcpServer('ws-1', 'remote', false));
    await settle();

    expect(mocks.getWorkspaceDisabledMcpServerNames.mock.calls).toEqual([['ws-1']]);
    expect(run.dispatched).toEqual([
      { type: 'mcpSettings/setWorkspaceDisabledMcpServers', payload: ['ws-1', { remote: true }] },
    ]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('workspace-toggle without a daemon id makes no wire call and writes no state', async () => {
    const noId = { name: 'no-id', type: 'stdio' as const, command: 'node' };
    const run = harness(mcpSettingsReducer(initialState, setServers([noId])));
    run.channel.put(toggleWorkspaceMcpServer('ws-1', 'no-id', false));
    await settle();

    expect(mocks.toggleWorkspaceMcpServer.mock.calls).toEqual([]);
    expect(run.dispatched).toEqual([]);
    run.task.cancel();
    await run.task.toPromise();
  });

  it('hydrates a workspace disabled map from the scoped list and keeps state on a failed read', async () => {
    mocks.getWorkspaceDisabledMcpServerNames
      .mockResolvedValueOnce(['linear', 'filesystem'])
      .mockResolvedValueOnce(null);
    const run = harness();
    run.channel.put(hydrateWorkspaceMcpDisabled('ws-1'));
    await settle();

    expect(mocks.getWorkspaceDisabledMcpServerNames.mock.calls).toEqual([['ws-1']]);
    expect(run.state().byWorkspaceId['ws-1'].disabledServers).toEqual({
      linear: true,
      filesystem: true,
    });

    run.channel.put(hydrateWorkspaceMcpDisabled('ws-1'));
    await settle();

    expect(run.state().byWorkspaceId['ws-1'].disabledServers).toEqual({
      linear: true,
      filesystem: true,
    });
    run.task.cancel();
    await run.task.toPromise();
  });
});

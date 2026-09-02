import { afterEach, describe, expect, it, vi } from 'vitest';

// FAKE transport only: no settings RPC ever reaches the real daemon. The
// `runMutation` helper stays real so each domain mutator asserts the JSON-RPC
// method + params it forwards to the mocked transport.
vi.mock('./backend-transport', () => ({
  backendRequest: vi.fn(),
  backendSubscribe: vi.fn(() => Promise.resolve({ subscriptionId: 'sub-set-1' })),
  backendUnsubscribe: vi.fn(() => Promise.resolve()),
  onBackendNotification: vi.fn(() => () => {}),
}));

import { backendRequest } from './backend-transport';
import { LiveSettingsClient } from './live-settings-client';

const mockedRequest = vi.mocked(backendRequest);

afterEach(() => vi.clearAllMocks());

describe('LiveSettingsClient wire requests (fake transport)', () => {
  it("list forwards settings.list with no params and surfaces the daemon's settings[] array", async () => {
    const fakeList = [
      {
        path: 'server.port',
        label: 'WS port',
        description: 'TCP port for the WSS listener',
        category: 'server',
        type: 'number',
        min: 1024,
        max: 65535,
        defaultValue: 5180,
        value: 5180,
      },
    ];
    mockedRequest.mockResolvedValueOnce({ settings: fakeList });
    const client = new LiveSettingsClient();

    const result = await client.list();

    expect(mockedRequest).toHaveBeenCalledWith('settings.list');
    expect(result).toEqual(fakeList);
  });

  it('list folds transport failures to an empty array (boot stays resilient)', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('boom'));
    const client = new LiveSettingsClient();
    expect(await client.list()).toEqual([]);
  });

  it('get forwards settings.get with { path } and merges the definition + value', async () => {
    mockedRequest.mockResolvedValueOnce({
      path: 'sourceControl.activeProvider',
      value: 'github',
      origin: 'file',
      revision: 12,
      definition: {
        path: 'sourceControl.activeProvider',
        label: 'Source-control provider',
        description: 'Active forge implementation',
        category: 'sourceControl',
        type: 'enum',
        enumValues: ['github'],
        defaultValue: 'github',
      },
    });
    const client = new LiveSettingsClient();

    const entry = await client.get('sourceControl.activeProvider');

    expect(mockedRequest).toHaveBeenCalledWith('settings.get', {
      path: 'sourceControl.activeProvider',
    });
    expect(entry).toEqual({
      path: 'sourceControl.activeProvider',
      label: 'Source-control provider',
      description: 'Active forge implementation',
      category: 'sourceControl',
      type: 'enum',
      enumValues: ['github'],
      defaultValue: 'github',
      value: 'github',
      origin: 'file',
      revision: 12,
    });
  });

  it('get folds an unknown-path transport error to null', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('invalid params'));
    const client = new LiveSettingsClient();
    expect(await client.get('does.not.exist')).toBeNull();
  });

  it('update forwards settings.update with { changes } and returns the applied list', async () => {
    mockedRequest.mockResolvedValueOnce({
      applied: [{ path: 'server.port', value: 5181 }],
    });
    const client = new LiveSettingsClient();

    const applied = await client.update([
      { path: 'server.port', value: 5181 },
      { path: 'sourceControl.github.tokenSource', value: 'gh-cli', reason: 'use gh auth token' },
    ]);

    expect(mockedRequest).toHaveBeenCalledWith('settings.update', {
      changes: [
        { path: 'server.port', value: 5181 },
        { path: 'sourceControl.github.tokenSource', value: 'gh-cli', reason: 'use gh auth token' },
      ],
    });
    expect(applied).toEqual([{ path: 'server.port', value: 5181 }]);
  });

  it('update is a no-op when changes[] is empty (no wire call)', async () => {
    const client = new LiveSettingsClient();
    expect(await client.update([])).toEqual([]);
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('reset forwards settings.reset with { path } and surfaces the restored value', async () => {
    mockedRequest.mockResolvedValueOnce({ path: 'server.port', value: 5180 });
    const client = new LiveSettingsClient();

    const applied = await client.reset('server.port');

    expect(mockedRequest).toHaveBeenCalledWith('settings.reset', { path: 'server.port' });
    expect(applied).toEqual({ path: 'server.port', value: 5180 });
  });
});

describe('LiveSettingsClient domain accessors map FE shapes ↔ BE paths', () => {
  it('getMcpServers reads mcp.servers.list (§5.22) and maps transport/enabled → type/disabled', async () => {
    mockedRequest.mockResolvedValueOnce({
      servers: [
        {
          id: 'srv-fs',
          name: 'filesystem',
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem'],
          env: { API_KEY: '********' },
          enabled: true,
        },
        {
          id: 'srv-gh',
          name: 'github',
          transport: 'http',
          url: 'https://mcp.github.com/mcp',
          enabled: false,
        },
      ],
    });
    const client = new LiveSettingsClient();

    const result = await client.getMcpServers();
    expect(mockedRequest).toHaveBeenCalledWith('mcp.servers.list');
    expect(result).toEqual([
      {
        id: 'srv-fs',
        name: 'filesystem',
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem'],
        env: { API_KEY: '********' },
      },
      {
        id: 'srv-gh',
        name: 'github',
        type: 'http',
        url: 'https://mcp.github.com/mcp',
        disabled: true,
      },
    ]);
  });

  it('getMcpServers folds a transport failure to an empty list', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('boom'));
    const client = new LiveSettingsClient();
    expect(await client.getMcpServers()).toEqual([]);
  });

  it('getWorkspaceDisabledMcpServerNames reads the workspace-scoped mcp.servers.list (§5.22)', async () => {
    // Workspace-scoped read: every entry adds `workspaceDisabled: boolean`.
    mockedRequest.mockResolvedValueOnce({
      servers: [
        {
          id: 'srv-fs',
          name: 'filesystem',
          transport: 'stdio',
          command: 'npx',
          enabled: true,
          workspaceDisabled: true,
        },
        {
          id: 'srv-gh',
          name: 'github',
          transport: 'http',
          url: 'https://mcp.github.com/mcp',
          enabled: true,
          workspaceDisabled: false,
        },
      ],
    });
    const client = new LiveSettingsClient();

    const result = await client.getWorkspaceDisabledMcpServerNames('ws-1');
    expect(mockedRequest).toHaveBeenCalledWith('mcp.servers.list', { workspaceId: 'ws-1' });
    expect(result).toEqual(['filesystem']);
  });

  it('getWorkspaceDisabledMcpServerNames folds a transport failure to null', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('boom'));
    const client = new LiveSettingsClient();
    expect(await client.getWorkspaceDisabledMcpServerNames('ws-1')).toBeNull();
  });

  it('toggleWorkspaceMcpServer sends the workspace-scoped mcp.servers.toggle (§5.22)', async () => {
    // Scoped toggle result: { status, workspaceDisabled } per the H1 contract.
    mockedRequest.mockResolvedValueOnce({
      status: {
        serverId: 'srv-fs',
        state: 'running',
        pid: 4821,
        toolCount: 7,
        startedAt: 1750000000000,
      },
      workspaceDisabled: true,
    });
    const client = new LiveSettingsClient();

    const result = await client.toggleWorkspaceMcpServer('ws-1', 'srv-fs', false);
    expect(mockedRequest).toHaveBeenCalledWith('mcp.servers.toggle', {
      serverId: 'srv-fs',
      enabled: false,
      workspaceId: 'ws-1',
    });
    expect(result).toEqual({ success: true, workspaceDisabled: true });
  });

  it('toggleWorkspaceMcpServer folds a not-found rejection to a failed MutationResult', async () => {
    // Unknown serverId or workspaceId → -32602 with data.code "not-found" (§5.22).
    mockedRequest.mockRejectedValueOnce(new Error('Invalid params'));
    const client = new LiveSettingsClient();
    expect(await client.toggleWorkspaceMcpServer('ws-x', 'srv-x', true)).toEqual({
      success: false,
      error: 'Invalid params',
    });
  });

  it('getMcpServerStatuses fans out mcp.servers.getStatus (§5.22) per serverId', async () => {
    // PROTOCOL §5.22 McpServerStatus — daemon-probed running server, then a
    // failed one. Point reads are issued in serverIds order.
    mockedRequest
      .mockResolvedValueOnce({
        status: {
          serverId: 'srv-up',
          state: 'running',
          pid: 4821,
          toolCount: 7,
          startedAt: 1750000000000,
        },
      })
      .mockResolvedValueOnce({
        status: { serverId: 'srv-down', state: 'error', lastError: 'unreachable from daemon host' },
      });
    const client = new LiveSettingsClient();

    const result = await client.getMcpServerStatuses(['srv-up', 'srv-down']);
    expect(mockedRequest.mock.calls).toEqual([
      ['mcp.servers.getStatus', { serverId: 'srv-up' }],
      ['mcp.servers.getStatus', { serverId: 'srv-down' }],
    ]);
    expect(result).toEqual([
      { serverId: 'srv-up', state: 'running' },
      { serverId: 'srv-down', state: 'error', lastError: 'unreachable from daemon host' },
    ]);
  });

  it('getMcpServerStatuses omits failed/malformed reads and keys results by the requested id', async () => {
    mockedRequest
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ status: { serverId: 'srv-odd', state: 'warming-up' } })
      .mockResolvedValueOnce({ status: { state: 'stopped' } })
      .mockResolvedValueOnce({ status: { serverId: 'srv-ok', state: 'stopped' } });
    const client = new LiveSettingsClient();

    const result = await client.getMcpServerStatuses([
      'srv-a',
      'srv-odd',
      'srv-echoless',
      'srv-ok',
    ]);
    expect(mockedRequest.mock.calls).toEqual([
      ['mcp.servers.getStatus', { serverId: 'srv-a' }],
      ['mcp.servers.getStatus', { serverId: 'srv-odd' }],
      ['mcp.servers.getStatus', { serverId: 'srv-echoless' }],
      ['mcp.servers.getStatus', { serverId: 'srv-ok' }],
    ]);
    expect(result).toEqual([
      { serverId: 'srv-echoless', state: 'stopped' },
      { serverId: 'srv-ok', state: 'stopped' },
    ]);
  });

  it('setMcpServers diffs against mcp.servers.list: creates new, deletes missing', async () => {
    mockedRequest.mockResolvedValueOnce({
      servers: [
        { id: 'srv-old', name: 'old-server', transport: 'stdio', command: 'old', enabled: true },
      ],
    });
    mockedRequest.mockResolvedValue({});
    const client = new LiveSettingsClient();

    const result = await client.setMcpServers([
      { name: 'fresh', type: 'stdio', command: 'npx', args: ['serve'] },
    ]);

    expect(mockedRequest).toHaveBeenNthCalledWith(1, 'mcp.servers.list');
    expect(mockedRequest).toHaveBeenNthCalledWith(2, 'mcp.servers.delete', { serverId: 'srv-old' });
    expect(mockedRequest).toHaveBeenNthCalledWith(3, 'mcp.servers.create', {
      config: { name: 'fresh', transport: 'stdio', enabled: true, command: 'npx', args: ['serve'] },
    });
    expect(result).toEqual({ success: true });
  });

  it('setMcpServers updates a changed body and toggles a changed enabled flag', async () => {
    mockedRequest.mockResolvedValueOnce({
      servers: [
        { id: 'srv-a', name: 'alpha', transport: 'stdio', command: 'alpha-cmd', enabled: true },
        { id: 'srv-b', name: 'beta', transport: 'stdio', command: 'beta-cmd', enabled: true },
      ],
    });
    mockedRequest.mockResolvedValue({});
    const client = new LiveSettingsClient();

    const result = await client.setMcpServers([
      { name: 'alpha', type: 'stdio', command: 'alpha-cmd-v2' },
      { name: 'beta', type: 'stdio', command: 'beta-cmd', disabled: true },
    ]);

    expect(mockedRequest).toHaveBeenNthCalledWith(2, 'mcp.servers.update', {
      serverId: 'srv-a',
      config: {
        name: 'alpha',
        transport: 'stdio',
        enabled: true,
        command: 'alpha-cmd-v2',
        id: 'srv-a',
      },
    });
    expect(mockedRequest).toHaveBeenNthCalledWith(3, 'mcp.servers.toggle', {
      serverId: 'srv-b',
      enabled: false,
    });
    expect(mockedRequest).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ success: true });
  });

  it('setMcpServers issues no update for an unchanged round-tripped server (secrets preserved)', async () => {
    const wire = {
      id: 'srv-fs',
      name: 'filesystem',
      transport: 'stdio' as const,
      command: 'npx',
      env: { TOKEN: '********' },
      enabled: true,
    };
    mockedRequest.mockResolvedValueOnce({ servers: [wire] });
    const client = new LiveSettingsClient();

    const result = await client.setMcpServers([
      { name: 'filesystem', type: 'stdio', command: 'npx', env: { TOKEN: '********' } },
    ]);

    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true });
  });

  it('setMcpServers folds a wire failure to { success: false, error }', async () => {
    mockedRequest.mockResolvedValueOnce({ servers: [] });
    mockedRequest.mockRejectedValueOnce(new Error('mcp server already exists: srv-x'));
    const client = new LiveSettingsClient();

    const result = await client.setMcpServers([{ name: 'x', type: 'stdio', command: 'x' }]);
    expect(result).toEqual({ success: false, error: 'mcp server already exists: srv-x' });
  });

  it('getProviderSettings folds providers.active + providers.enabled out of settings.list', async () => {
    mockedRequest.mockResolvedValueOnce({
      settings: [
        {
          path: 'providers.active',
          label: '',
          description: '',
          category: 'providers',
          type: 'string',
          value: 'auggie',
        },
        {
          path: 'providers.enabled',
          label: '',
          description: '',
          category: 'providers',
          type: 'object',
          value: { auggie: true, 'claude-code': false },
        },
      ],
    });
    const client = new LiveSettingsClient();

    const result = await client.getProviderSettings();
    expect(result).toEqual({
      activeProviderId: 'auggie',
      enabledProviders: { auggie: true, 'claude-code': false },
    });
  });

  it('setProviderSettings only forwards the fields the caller actually changed', async () => {
    mockedRequest.mockResolvedValueOnce({ applied: [] });
    const client = new LiveSettingsClient();

    await client.setProviderSettings({ activeProviderId: 'codex' });
    expect(mockedRequest).toHaveBeenCalledWith('settings.update', {
      changes: [{ path: 'providers.active', value: 'codex' }],
    });
  });

  // monorepo#1729: the quick-action model settings live under `quickActions.*`
  // on the wire (renamed from `backgroundAgents.*`, which the daemon retired).
  it('getBackgroundAgentSettings folds the quickActions.* paths out of settings.list', async () => {
    mockedRequest.mockResolvedValueOnce({
      settings: [
        {
          path: 'quickActions.defaultModel',
          label: '',
          description: '',
          category: 'providers',
          type: 'string',
          value: 'auggie:haiku',
        },
        {
          path: 'quickActions.typeOverrides',
          label: '',
          description: '',
          category: 'providers',
          type: 'object',
          value: { commit: 'auggie:fast', pr: '', review: '', fast: '' },
        },
        {
          path: 'quickActions.providerSettings',
          label: '',
          description: '',
          category: 'providers',
          type: 'object',
          value: { auggie: { defaultModel: 'auggie:haiku' } },
        },
      ],
    });
    const client = new LiveSettingsClient();

    const result = await client.getBackgroundAgentSettings();
    expect(mockedRequest).toHaveBeenCalledWith('settings.list');
    expect(result).toEqual({
      defaultModel: 'auggie:haiku',
      typeOverrides: { commit: 'auggie:fast', pr: '', review: '', fast: '' },
      providerSettings: { auggie: { defaultModel: 'auggie:haiku' } },
    });
  });

  it('setBackgroundAgentSettings writes the quickActions.* paths on the wire', async () => {
    mockedRequest.mockResolvedValueOnce({ applied: [] });
    const client = new LiveSettingsClient();

    await client.setBackgroundAgentSettings({ defaultModel: 'auggie:opus' });
    expect(mockedRequest).toHaveBeenCalledWith('settings.update', {
      changes: [{ path: 'quickActions.defaultModel', value: 'auggie:opus' }],
    });
  });

  it('getMcpServers preserves the daemon-assigned id so status events can resolve name', async () => {
    // The `mcp.servers:status-changed` bridge (§6.5) receives `{ serverId, status }`
    // and looks the config up by id in the slice. `fromWireMcpConfig` must
    // therefore carry the id through — this pins that shape.
    mockedRequest.mockResolvedValueOnce({
      servers: [
        {
          id: 'srv-fs',
          name: 'filesystem',
          transport: 'stdio',
          command: 'npx',
          enabled: true,
        },
      ],
    });
    const client = new LiveSettingsClient();

    const result = await client.getMcpServers();
    expect(result).toEqual([{ id: 'srv-fs', name: 'filesystem', type: 'stdio', command: 'npx' }]);
  });

  it('getWorkspaceSettings reads workspace.getAutoCommit and maps to { autoCommitEnabled }', async () => {
    // Per-workspace persisted override (PROTOCOL §5.1): the daemon resolves
    // the workspace's own value (`source: "workspace"`) or falls back to the
    // global `git.autoCommit` (`source: "global"`).
    mockedRequest.mockResolvedValueOnce({
      autoCommit: { enabled: false, source: 'workspace' },
    });
    const client = new LiveSettingsClient();
    expect(await client.getWorkspaceSettings('ws-1')).toEqual({ autoCommitEnabled: false });
    expect(mockedRequest).toHaveBeenCalledWith('workspace.getAutoCommit', {
      workspaceId: 'ws-1',
    });
  });

  it('getWorkspaceSettings returns null on a malformed response', async () => {
    mockedRequest.mockResolvedValueOnce({});
    const client = new LiveSettingsClient();
    expect(await client.getWorkspaceSettings('ws-1')).toBeNull();
  });

  it('setWorkspaceSettings persists via workspace.setAutoCommit (not the global setting)', async () => {
    mockedRequest.mockResolvedValueOnce({
      autoCommit: { enabled: false, source: 'workspace' },
    });
    const client = new LiveSettingsClient();
    const result = await client.setWorkspaceSettings('ws-1', { autoCommitEnabled: false });
    expect(mockedRequest).toHaveBeenCalledWith('workspace.setAutoCommit', {
      workspaceId: 'ws-1',
      enabled: false,
    });
    expect(result).toEqual({ success: true });
  });

  it('setWorkspaceSettings without autoCommitEnabled is a no-op on the wire', async () => {
    const client = new LiveSettingsClient();
    const result = await client.setWorkspaceSettings('ws-1', {});
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });
});

describe('LiveSettingsClient user-rule accessors (rules.* — PROTOCOL §5.21)', () => {
  it('getUserRule forwards rules.get with the global-sentinel workspaceId + ruleType', async () => {
    mockedRequest.mockResolvedValueOnce({
      enabled: true,
      content: 'Always write tests.',
      updatedAt: 1750000000000,
    });
    const client = new LiveSettingsClient();

    const rule = await client.getUserRule('base-system-prompt');

    expect(mockedRequest).toHaveBeenCalledWith('rules.get', {
      workspaceId: 'global',
      ruleType: 'base-system-prompt',
    });
    expect(rule).toEqual({
      enabled: true,
      content: 'Always write tests.',
      updatedAt: 1750000000000,
    });
  });

  it("getUserRule surfaces the daemon's absent-override default verbatim", async () => {
    // §5.21: an absent type reads back as a disabled empty default — not null.
    mockedRequest.mockResolvedValueOnce({ enabled: false, content: '', updatedAt: 0 });
    const client = new LiveSettingsClient();
    expect(await client.getUserRule('base-system-prompt')).toEqual({
      enabled: false,
      content: '',
      updatedAt: 0,
    });
  });

  it('getUserRule folds a failed wire probe to null (visible load-error path)', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('boom'));
    const client = new LiveSettingsClient();
    expect(await client.getUserRule('base-system-prompt')).toBeNull();
  });

  it('updateUserRule forwards rules.update with workspaceId/ruleType/content', async () => {
    mockedRequest.mockResolvedValueOnce({ rules: { rules: [] } });
    const client = new LiveSettingsClient();

    const result = await client.updateUserRule('base-system-prompt', 'Be thorough.');

    expect(mockedRequest).toHaveBeenCalledWith('rules.update', {
      workspaceId: 'global',
      ruleType: 'base-system-prompt',
      content: 'Be thorough.',
    });
    expect(result).toEqual({ success: true });
  });

  it('updateUserRule includes enabled only when the caller passes it', async () => {
    mockedRequest.mockResolvedValueOnce({ rules: { rules: [] } });
    const client = new LiveSettingsClient();

    await client.updateUserRule('base-system-prompt', 'Be thorough.', false);

    expect(mockedRequest).toHaveBeenCalledWith('rules.update', {
      workspaceId: 'global',
      ruleType: 'base-system-prompt',
      content: 'Be thorough.',
      enabled: false,
    });
  });

  it('updateUserRule surfaces a rejected update as { success:false, error }', async () => {
    mockedRequest.mockRejectedValueOnce(new Error('rule content exceeds 50000 characters'));
    const client = new LiveSettingsClient();

    const result = await client.updateUserRule('base-system-prompt', 'x');

    expect(result.success).toBe(false);
    expect(result.error).toContain('rule content exceeds');
  });
});

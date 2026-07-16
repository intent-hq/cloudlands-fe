import { beforeEach, describe, expect, it, vi } from 'vitest';

const { backendRequestSpy, localPrefSpy } = vi.hoisted(() => ({
  backendRequestSpy: vi.fn(),
  localPrefSpy: vi.fn(),
}));

vi.mock('../../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: backendRequestSpy }),
}));

vi.mock('../../../../../main/local-prefs', () => ({
  getLocalPref: localPrefSpy,
}));

import { AppSettingsValidationError, buildWsAppSettingsApi } from '../ws-app-settings-api';
import type { ToolCall } from '../protocol';

const call = {
  name: 'workspace_api',
  arguments: {},
  context: { agentId: 'agent-chief' },
} as ToolCall;

describe('buildWsAppSettingsApi', () => {
  beforeEach(() => {
    backendRequestSpy.mockReset();
    localPrefSpy.mockReset();
  });

  it('builds a settings proposal for valid schema-backed changes', async () => {
    const api = buildWsAppSettingsApi('__chief__', call);

    const result = await api.propose({
      changes: [{ path: 'theme.preference', value: 'dark' }],
    });

    expect(result.ok).toBe(true);
    expect(result.proposal).toMatchObject({
      kind: 'settings-change',
      payload: {
        changes: [
          {
            path: 'theme.preference',
            value: 'dark',
            apply: { kind: 'redux-action', action: 'theme/requestThemePreferenceChange' },
          },
        ],
      },
    });
  });

  it('returns a structured validation error for unknown setting paths', async () => {
    const api = buildWsAppSettingsApi('__chief__', call);

    await expect(
      api.propose({ changes: [{ path: 'theme.doesNotExist', value: 'dark' }] }),
    ).rejects.toMatchObject({
      code: 'APP_SETTINGS_VALIDATION_ERROR',
      details: {
        path: 'theme.doesNotExist',
        reason: 'unknown setting path',
        expected: 'a path from APP_SETTING_DEFINITIONS',
      },
    });
  });

  it('returns a structured validation error for out-of-range values', async () => {
    const api = buildWsAppSettingsApi('__chief__', call);

    await expect(
      api.propose({ changes: [{ path: 'notifications.volume', value: 2 }] }),
    ).rejects.toBeInstanceOf(AppSettingsValidationError);
    await expect(
      api.propose({ changes: [{ path: 'notifications.volume', value: 2 }] }),
    ).rejects.toMatchObject({
      code: 'APP_SETTINGS_VALIDATION_ERROR',
      details: {
        path: 'notifications.volume',
        reason: 'value must be <= 1',
        expected: 'number',
        value: 2,
      },
    });
  });

  // The `source: 'electron-store'` reads used to open an on-disk store via
  // `getSettingsStore(storeName)`. After B6 the FE-main electron-store facade
  // is retired: each schema path routes onto its P3-4 owner (daemon
  // settings-catalog or `main/local-prefs.ts`). These tests pin the wire /
  // helper contracts so a schema/mapping regression is caught early.

  it('routes electron-store-sourced reads through daemon settings.get with the mapped path', async () => {
    backendRequestSpy.mockImplementation(async (method: string, params: { path: string }) => {
      expect(method).toBe('settings.get');
      if (params.path === 'workspace.branchPrefix') {
        return { path: params.path, value: 'feature/' };
      }
      throw new Error(`unexpected settings.get for ${params.path}`);
    });

    const api = buildWsAppSettingsApi('__chief__', call);
    const result = await api.get('workspace.branchPrefix');

    expect(backendRequestSpy).toHaveBeenCalledWith('settings.get', {
      path: 'workspace.branchPrefix',
    });
    expect(result).toMatchObject({
      path: 'workspace.branchPrefix',
      source: 'daemon-settings',
      value: 'feature/',
    });
    expect(localPrefSpy).not.toHaveBeenCalled();
  });

  it('remaps workspace.autoCommit onto the daemon git.autoCommit path', async () => {
    backendRequestSpy.mockResolvedValue({ path: 'git.autoCommit', value: false });

    const api = buildWsAppSettingsApi('__chief__', call);
    const result = await api.get('workspace.autoCommit');

    expect(backendRequestSpy).toHaveBeenCalledWith('settings.get', { path: 'git.autoCommit' });
    expect(result).toMatchObject({ path: 'workspace.autoCommit', value: false });
  });

  it('extracts providers.paths sub-keys from the daemon providers.paths object', async () => {
    backendRequestSpy.mockImplementation(async (_method: string, params: { path: string }) => {
      if (params.path === 'providers.paths') {
        return {
          path: 'providers.paths',
          value: { 'claude-code': '/opt/claude', codex: '/opt/codex' },
        };
      }
      throw new Error(`unexpected settings.get for ${params.path}`);
    });

    const api = buildWsAppSettingsApi('__chief__', call);
    const result = await api.get('providers.paths.claude-code');

    expect(backendRequestSpy).toHaveBeenCalledWith('settings.get', { path: 'providers.paths' });
    expect(result).toMatchObject({
      path: 'providers.paths.claude-code',
      value: '/opt/claude',
    });
  });

  it('routes rtk.enabled through daemon settings.get (migrated from FE-local)', async () => {
    backendRequestSpy.mockResolvedValue({ value: true });

    const api = buildWsAppSettingsApi('__chief__', call);
    const result = await api.get('rtk.enabled');

    expect(backendRequestSpy).toHaveBeenCalledWith('settings.get', { path: 'rtk.enabled' });
    expect(localPrefSpy).not.toHaveBeenCalled();
    expect(result).toMatchObject({ path: 'rtk.enabled', value: true });
  });

  it('routes FE-local electron-store paths through main/local-prefs.getLocalPref', async () => {
    localPrefSpy.mockImplementation(async (key: string) => {
      if (key === 'betaUpdatesEnabled') return true;
      return undefined;
    });

    const api = buildWsAppSettingsApi('__chief__', call);
    const result = await api.get('preferences.betaUpdatesEnabled');

    expect(localPrefSpy).toHaveBeenCalledWith('betaUpdatesEnabled');
    expect(backendRequestSpy).not.toHaveBeenCalled();
    expect(result).toMatchObject({ path: 'preferences.betaUpdatesEnabled', value: true });
  });

  it('falls back to the schema defaultValue when no P3-4 owner is mapped (accounts.sentry)', async () => {
    const api = buildWsAppSettingsApi('__chief__', call);
    const result = await api.get('accounts.sentry');

    // accounts.sentry is sensitive + read-only; unmapped after B6. The
    // valueForResult redactor folds the null default to a plain null.
    expect(backendRequestSpy).not.toHaveBeenCalled();
    expect(localPrefSpy).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      path: 'accounts.sentry',
      value: null,
      valueRedacted: true,
    });
  });


  it("mcp.servers reads through daemon mcp.servers.list and reshapes to a name-keyed record", async () => {
    // PROTOCOL §5.22 — the on-disk `~/.augment/settings.json` shape was
    // `Record<name, config>`; the daemon exposes an array. The API must
    // reshape it back to a record so callers see a stable contract.
    // Sensitive `env`/`headers` are redacted by `valueForResult` before
    // reaching the caller (schema entry has `sensitive: true`).
    backendRequestSpy.mockImplementation(async (method: string) => {
      if (method === "mcp.servers.list") {
        return {
          servers: [
            {
              id: "srv-fs",
              name: "filesystem",
              transport: "stdio",
              command: "npx",
              args: ["-y", "@modelcontextprotocol/server-filesystem"],
              env: { API_KEY: "supersecret" },
              enabled: true,
            },
          ],
        };
      }
      throw new Error(`unexpected request ${method}`);
    });

    const api = buildWsAppSettingsApi("__chief__", call);
    const result = await api.get("mcp.servers");

    expect(backendRequestSpy).toHaveBeenCalledWith("mcp.servers.list");
    expect(result).toMatchObject({
      path: "mcp.servers",
      valueRedacted: true,
    });
    // The record is keyed by server name; the daemon id + name are stripped
    // from the value body. Secret-ish keys are redacted by `valueForResult`.
    expect(result?.value).toEqual({
      filesystem: {
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem"],
        env: "[redacted]",
        enabled: true,
      },
    });
  });

  it("mcp.servers folds a daemon failure to the schema defaultValue ({})", async () => {
    backendRequestSpy.mockRejectedValue(new Error("daemon offline"));

    const api = buildWsAppSettingsApi("__chief__", call);
    const result = await api.get("mcp.servers");

    expect(backendRequestSpy).toHaveBeenCalledWith("mcp.servers.list");
    expect(result).toMatchObject({ path: "mcp.servers", value: {} });
  });

  it('folds daemon settings.get failures into the schema defaultValue', async () => {
    backendRequestSpy.mockRejectedValue(new Error('daemon offline'));

    const api = buildWsAppSettingsApi('__chief__', call);
    const result = await api.get('workspace.branchPrefix');

    expect(backendRequestSpy).toHaveBeenCalledWith('settings.get', {
      path: 'workspace.branchPrefix',
    });
    expect(result).toMatchObject({ path: 'workspace.branchPrefix', value: '' });
  });
});

import { describe, expect, it } from 'vitest';
import {
  initialState,
  mcpSettingsReducer,
  setAdvancedSaveStatus,
  setServerErrorMessage,
  setServerStatus,
  setServers,
  setWorkspaceDisabledMcpServers,
  setWorkspaceMcpServerDisabled,
} from './mcp-settings-slice';
import type { McpServerConfig } from './mcp-settings-types';

const servers: McpServerConfig[] = [
  { name: 'filesystem', type: 'stdio', command: 'npx' },
  { name: 'linear', type: 'http', url: 'https://mcp.linear.app' },
];

describe('mcpSettingsReducer', () => {
  it('stores server configuration in the unified MCP state', () => {
    const state = mcpSettingsReducer(initialState, setServers(servers));

    expect(state.servers).toEqual(servers);
  });

  it('stores runtime status and error data in the unified MCP state', () => {
    let state = mcpSettingsReducer(initialState, setServerStatus('linear', 'error'));
    state = mcpSettingsReducer(state, setServerErrorMessage('linear', 'Unauthorized'));

    expect(state.statusMap.linear).toBe('error');
    expect(state.errorMessages.linear).toBe('Unauthorized');
  });

  it('tracks the advanced-editor save status and clears the error on non-error states', () => {
    expect(initialState.advancedSaveStatus).toBe('idle');

    let state = mcpSettingsReducer(initialState, setAdvancedSaveStatus('error', 'bad JSON'));
    expect(state.advancedSaveStatus).toBe('error');
    expect(state.advancedSaveError).toBe('bad JSON');

    state = mcpSettingsReducer(state, setAdvancedSaveStatus('saved'));
    expect(state.advancedSaveStatus).toBe('saved');
    expect(state.advancedSaveError).toBeNull();
  });

  it('stores the daemon-confirmed per-workspace disabled state by adding and removing names', () => {
    let state = mcpSettingsReducer(
      initialState,
      setWorkspaceMcpServerDisabled('ws-1', 'linear', true),
    );

    expect(state.byWorkspaceId['ws-1'].disabledServers).toEqual({ linear: true });

    state = mcpSettingsReducer(state, setWorkspaceMcpServerDisabled('ws-1', 'linear', false));

    expect(state.byWorkspaceId['ws-1'].disabledServers).toEqual({});
  });

  it('returns the same reference when a workspace disabled write does not change state', () => {
    const state = mcpSettingsReducer(
      initialState,
      setWorkspaceMcpServerDisabled('ws-1', 'linear', true),
    );
    const nextState = mcpSettingsReducer(
      state,
      setWorkspaceMcpServerDisabled('ws-1', 'linear', true),
    );

    expect(nextState).toBe(state);
  });

  it("replaces a workspace's disabled map from the daemon's scoped list", () => {
    let state = mcpSettingsReducer(
      initialState,
      setWorkspaceMcpServerDisabled('ws-1', 'stale', true),
    );

    state = mcpSettingsReducer(
      state,
      setWorkspaceDisabledMcpServers('ws-1', { linear: true, filesystem: true }),
    );

    expect(state.byWorkspaceId['ws-1'].disabledServers).toEqual({
      linear: true,
      filesystem: true,
    });

    state = mcpSettingsReducer(state, setWorkspaceDisabledMcpServers('ws-1', {}));

    expect(state.byWorkspaceId['ws-1'].disabledServers).toEqual({});
  });
});

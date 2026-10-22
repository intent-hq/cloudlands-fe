import { describe, expect, it } from 'vitest';
import type { StoreState } from '../../types';
import { initialState } from './mcp-settings-slice';
import type { McpSettingsState, McpServerConfig } from './mcp-settings-types';
import {
  selectMcpServerErrorMessage,
  selectMcpServersWithStatus,
  selectWorkspaceDisabledMcpServerKeysByWorkspaceId,
} from './mcp-settings-selectors';

const servers: McpServerConfig[] = [
  { name: 'filesystem', type: 'stdio', command: 'npx' },
  { name: 'linear', type: 'http', url: 'https://mcp.linear.app' },
];

function mockState(mcpSettings: Partial<McpSettingsState> = {}) {
  return {
    mcpSettings: {
      ...initialState,
      servers,
      ...mcpSettings,
    },
  } as StoreState;
}

describe('mcp-settings selectors', () => {
  it('derives server status view models without storing them', () => {
    const state = mockState({
      disabledServers: { linear: true },
      statusMap: { filesystem: 'configured', linear: 'connected' },
      toolsMap: { filesystem: [{ name: 'read_file' }] },
      errorMessages: { filesystem: 'tool failed' },
    });

    expect(selectMcpServersWithStatus.select(state)).toEqual([
      {
        ...servers[0],
        disabled: false,
        status: 'configured',
        tools: [{ name: 'read_file' }],
        toolCount: 1,
        errorMessage: 'tool failed',
      },
      {
        ...servers[1],
        disabled: true,
        status: 'disabled',
        tools: [],
        toolCount: 0,
        errorMessage: undefined,
      },
    ]);
  });

  it('derives workspace disabled names from the unified state', () => {
    const state = mockState({
      byWorkspaceId: {
        'ws-1': { disabledServers: { linear: true } },
      },
    });

    expect(selectWorkspaceDisabledMcpServerKeysByWorkspaceId.select(state, 'ws-1')).toEqual([
      'linear',
    ]);
  });

  it('selects per-server error messages from the unified runtime error map', () => {
    const state = mockState({ errorMessages: { linear: 'Unauthorized' } });

    expect(selectMcpServerErrorMessage.select(state, 'linear')).toBe('Unauthorized');
    expect(selectMcpServerErrorMessage.select(state, 'filesystem')).toBeUndefined();
  });
});

it('joins same-name server metadata only by ID', () => {
  const state = mockState({
    servers: [
      { id: 'a', name: 'same', type: 'http' },
      { id: 'b', name: 'same', type: 'http' },
    ],
    disabledServers: { b: true },
    statusMap: { a: 'error', b: 'connected' },
    errorMessages: { a: 'failed' },
    toolsMap: { a: [{ name: 'tool' }] },
  });
  expect(
    selectMcpServersWithStatus
      .select(state)
      .map(({ id, status, errorMessage, toolCount }) => ({ id, status, errorMessage, toolCount })),
  ).toEqual([
    { id: 'a', status: 'error', errorMessage: 'failed', toolCount: 1 },
    { id: 'b', status: 'disabled', errorMessage: undefined, toolCount: 0 },
  ]);
});

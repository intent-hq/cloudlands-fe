import { describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '$shared/ipc-registry';
import { getAppUiTargets } from '$shared/app-ui-targets';
import { buildAppUiApi } from '../ws-app-ui-api';

describe('buildAppUiApi', () => {
  it('sends navigate events to workspace windows', async () => {
    const send = vi.fn();
    const api = buildAppUiApi({ workspaceId: 'workspace-1', send });

    const result = await api.navigate('/settings?tab=setup#mcp-servers');

    expect(result).toEqual({
      ok: true,
      route: '/settings?tab=setup#mcp-servers',
      workspaceId: 'workspace-1',
      highlightId: 'mcp-servers',
    });
    expect(send).toHaveBeenCalledWith('workspace-1', IPC_CHANNELS.APP.UI_NAVIGATE, {
      route: '/settings?tab=setup#mcp-servers',
      workspaceId: 'workspace-1',
      highlightId: 'mcp-servers',
    });
  });

  it('sends highlight events with custom durations', async () => {
    const send = vi.fn();
    const api = buildAppUiApi({ workspaceId: 'workspace-1', send });

    const result = await api.highlight('theme', { durationMs: 750 });

    expect(result).toEqual({ ok: true, id: 'theme', workspaceId: 'workspace-1', durationMs: 750 });
    expect(send).toHaveBeenCalledWith('workspace-1', IPC_CHANNELS.APP.UI_HIGHLIGHT, {
      id: 'theme',
      workspaceId: 'workspace-1',
      durationMs: 750,
    });
  });

  it('rejects blank routes and highlight ids', async () => {
    const api = buildAppUiApi({ workspaceId: 'workspace-1', send: vi.fn() });

    await expect(api.navigate('   ')).rejects.toThrow('route cannot be empty');
    await expect(api.highlight('   ')).rejects.toThrow('id cannot be empty');
  });

  it('returns the typed target registry', async () => {
    const api = buildAppUiApi({ workspaceId: 'workspace-1', send: vi.fn() });

    await expect(api.targets()).resolves.toEqual(getAppUiTargets());
    await expect(api.targets()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'appearance',
          tab: 'fonts-colors',
          hashAliases: ['appearance', 'theme'],
          scrollSelector: '#theme',
          highlightSelector: '[data-highlight-id="theme"]',
        }),
        expect.objectContaining({ id: 'workspace-card', dynamic: true }),
        expect.objectContaining({ id: 'specialist-entry', dynamic: true }),
      ]),
    );
  });
});

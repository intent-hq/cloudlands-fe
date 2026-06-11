import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { WorkspaceClient } from '../workspace.client';

describe('WorkspaceClient cache bounds', () => {
  const invoke = vi.fn();

  beforeEach(() => {
    invoke.mockImplementation(async (_channel: string, payload?: { id?: string }) => ({
      ok: true,
      data: {
        id: payload?.id ?? 'workspace-list',
        title: 'Workspace',
        path: '/tmp/workspace',
      },
    }));
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: { invoke },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, 'electronAPI');
  });

  it('evicts oldest cached GET responses when the cache cap is exceeded', async () => {
    const client = new WorkspaceClient();

    for (let i = 0; i <= 100; i++) {
      await client.get(`ws-${i}` as any);
    }

    await client.get('ws-0' as any);

    expect(invoke).toHaveBeenCalledTimes(102);
  });
});
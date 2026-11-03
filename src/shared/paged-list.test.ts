import { describe, expect, it, vi } from 'vitest';
import { collectListPages } from './paged-list';

describe('collectListPages', () => {
  it('returns a whole-list reply unchanged after one request', async () => {
    const request = vi.fn(async () => ({ workspaces: [{ id: 'a' }], extra: 1 }));
    const reply = await collectListPages(request, undefined, 'workspaces');
    expect(reply).toEqual({ workspaces: [{ id: 'a' }], extra: 1 });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(undefined);
  });

  it('follows nextToken with the same params and concatenates rows', async () => {
    const pages: Record<string, { agents: unknown[]; nextToken: string | null; count?: number }> = {
      first: { agents: [{ id: '1' }], nextToken: 't1', count: 3 },
      t1: { agents: [{ id: '2' }], nextToken: 't2' },
      t2: { agents: [{ id: '3' }], nextToken: null },
    };
    const request = vi.fn(async (params?: Record<string, unknown>) => {
      const token = typeof params?.nextToken === 'string' ? params.nextToken : 'first';
      return pages[token];
    });
    const reply = await collectListPages(request, { workspaceId: 'w' }, 'agents');
    expect(reply).toEqual({
      agents: [{ id: '1' }, { id: '2' }, { id: '3' }],
      nextToken: null,
      count: 3,
    });
    expect(request).toHaveBeenNthCalledWith(1, { workspaceId: 'w' });
    expect(request).toHaveBeenNthCalledWith(2, { workspaceId: 'w', nextToken: 't1' });
    expect(request).toHaveBeenNthCalledWith(3, { workspaceId: 'w', nextToken: 't2' });
  });

  it('passes a missing first reply through', async () => {
    const reply = await collectListPages(async () => undefined, {}, 'queue');
    expect(reply).toBeUndefined();
  });

  it('propagates a failed page read', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ queue: [{ id: 'q' }], nextToken: 'n' })
      .mockRejectedValueOnce(new Error('boom'));
    await expect(collectListPages(request, { agentId: 'a' }, 'queue')).rejects.toThrow('boom');
  });
});

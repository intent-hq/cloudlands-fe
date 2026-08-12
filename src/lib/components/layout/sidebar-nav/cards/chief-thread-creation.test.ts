import { describe, expect, it, vi } from 'vitest';
import { ensureChiefThreadCreation } from './chief-thread-creation';

describe('ensureChiefThreadCreation', () => {
  it('shares one in-flight launch across concurrent callers', async () => {
    let resolveLaunch!: (agentId: string) => void;
    const create = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveLaunch = resolve;
        }),
    );

    const first = ensureChiefThreadCreation(create);
    const second = ensureChiefThreadCreation(create);
    await Promise.resolve();

    expect(create).toHaveBeenCalledTimes(1);
    resolveLaunch('agent-chief');
    await expect(Promise.all([first, second])).resolves.toEqual(['agent-chief', 'agent-chief']);
  });

  it('allows a later launch after the shared launch settles', async () => {
    const create = vi.fn().mockResolvedValueOnce('agent-first').mockResolvedValueOnce('agent-next');

    await expect(ensureChiefThreadCreation(create)).resolves.toBe('agent-first');
    await expect(ensureChiefThreadCreation(create)).resolves.toBe('agent-next');

    expect(create).toHaveBeenCalledTimes(2);
  });

  it('clears a failed launch so opening the panel can retry', async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce('agent');

    await expect(ensureChiefThreadCreation(create)).rejects.toThrow('offline');
    await expect(ensureChiefThreadCreation(create)).resolves.toBe('agent');
  });
});

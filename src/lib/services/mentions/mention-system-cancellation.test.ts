import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '$lib/utils/client-logger';
import { MentionSystem } from './mention-system';
import { providerRegistry } from './providers';
import type { MentionCandidate, Provider } from './types';

vi.mock('./providers', () => ({
  providerRegistry: { getDefault: vi.fn(), getByTrigger: vi.fn(() => []) },
}));

const context = { workspaceId: 'workspace-1' };
const current: MentionCandidate = {
  id: 'alex-current',
  type: 'file',
  label: 'alex.ts',
  uri: 'file:alex.ts',
};

describe('MentionSystem search cancellation', () => {
  let system: MentionSystem;
  let provider: Provider;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    provider = { id: 'file', search: vi.fn(async () => [current]) };
    vi.mocked(providerRegistry.getDefault).mockReturnValue([provider]);
    system = new MentionSystem({ debounceMs: 100 });
  });

  afterEach(() => {
    system.destroy();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('settles superseded queries quietly while the latest query completes', async () => {
    const first = system.search('a', context);
    const second = system.search('al', context);
    const latest = system.search('alex', context);
    await expect(Promise.all([first, second])).resolves.toEqual([[], []]);
    await vi.advanceTimersByTimeAsync(100);
    expect((await latest).map((item) => item.id)).toEqual(['alex-current']);
    expect(provider.search).toHaveBeenCalledTimes(1);
    expect(provider.search).toHaveBeenCalledWith('alex', expect.objectContaining(context));
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('does not log an aborted provider while the replacement search completes', async () => {
    vi.mocked(provider.search).mockImplementationOnce(
      (_query, { signal }) =>
        new Promise((_resolve, reject) => {
          signal!.addEventListener(
            'abort',
            () => reject(new DOMException('Stopped', 'AbortError')),
            {
              once: true,
            },
          );
        }),
    );
    const first = system.search('al', context);
    await vi.advanceTimersByTimeAsync(100);
    const latest = system.search('alex', context);
    await expect(first).resolves.toEqual([]);
    await vi.advanceTimersByTimeAsync(100);
    expect((await latest).map((item) => item.id)).toEqual(['alex-current']);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('discards late cancelled results without caching them or replacing current results', async () => {
    let finishOld!: (items: MentionCandidate[]) => void;
    vi.mocked(provider.search).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    );
    const first = system.search('al', context);
    await vi.advanceTimersByTimeAsync(100);
    const latest = system.search('alex', context);
    await expect(first).resolves.toEqual([]);
    await vi.advanceTimersByTimeAsync(100);
    expect((await latest).map((item) => item.id)).toEqual(['alex-current']);
    finishOld([{ id: 'old', type: 'file', label: 'old.ts', uri: 'file:old.ts' }]);
    await vi.advanceTimersByTimeAsync(0);
    expect((await system.search('alex', context)).map((item) => item.id)).toEqual(['alex-current']);
    expect(provider.search).toHaveBeenCalledTimes(2);
    const uncached = system.search('al', context);
    await vi.advanceTimersByTimeAsync(100);
    expect((await uncached).map((item) => item.id)).toEqual(['alex-current']);
    expect(provider.search).toHaveBeenCalledTimes(3);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('settles a pending search quietly when the system is destroyed', async () => {
    const pending = system.search('alex', context);
    system.destroy();
    await expect(pending).resolves.toEqual([]);
    expect(provider.search).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it.each([
    new Error('Provider unavailable'),
    new Error('Search cancelled'),
    new DOMException('Transport aborted without search cancellation', 'AbortError'),
  ])('keeps a genuine provider failure visible: %s', async (failure) => {
    vi.mocked(provider.search).mockRejectedValueOnce(failure);
    const result = system.search('alex', context);
    await vi.advanceTimersByTimeAsync(100);
    await expect(result).resolves.toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      '[SearchService] Provider file search failed:',
      failure,
    );
  });
});

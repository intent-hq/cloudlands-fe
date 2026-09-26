import { afterEach, describe, expect, it, vi } from 'vitest';
import { DebouncedSearchService } from './search-service';
import type { MentionCandidate, Provider, SearchContext } from './types';

const context: SearchContext = { workspaceId: 'workspace-1' };
const result: MentionCandidate = {
  id: 'file-result',
  label: 'result.ts',
  type: 'file',
  uri: 'file:result.ts',
};

describe('DebouncedSearchService cancellation', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('settles a debounced search when a newer search cancels it', async () => {
    vi.useFakeTimers();
    const provider: Provider = {
      id: 'file',
      search: vi.fn(async () => [result]),
    };
    const service = new DebouncedSearchService({ debounceMs: 100 });

    const firstOutcome = service.search('a', [provider], context).catch((error) => error);
    const secondSearch = service.search('ab', [provider], context);

    await expect(firstOutcome).resolves.toMatchObject({ message: 'Search cancelled' });
    await vi.advanceTimersByTimeAsync(100);
    await expect(secondSearch).resolves.toEqual([result]);
    expect(service.isLoading()).toBe(false);
  });

  it('does not reuse another provider selection’s cached results', async () => {
    const service = new DebouncedSearchService();
    const file: Provider = { id: 'file', search: async () => [result] };
    const note: Provider = {
      id: 'note',
      search: async () => [{ id: 'spec', label: 'Spec', type: 'note', uri: 'note:spec' }],
    };
    expect(await service.search('', [file], context)).toEqual([result]);
    expect(await service.search('', [note], context)).toMatchObject([{ type: 'note', id: 'spec' }]);
    service.destroy();
  });

  it('continues caching unchanged provider context', async () => {
    const service = new DebouncedSearchService();
    const provider: Provider = {
      id: 'file',
      search: vi.fn(async () => [result]),
      getCacheKey: () => 'same-context',
    };
    await service.search('', [provider], context);
    expect(await service.search('', [provider], context)).toEqual([result]);
    expect(provider.search).toHaveBeenCalledTimes(1);
    service.destroy();
  });
});

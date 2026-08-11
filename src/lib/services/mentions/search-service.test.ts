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
});

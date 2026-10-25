import { afterEach, describe, expect, it, vi } from 'vitest';
import { DebouncedSearchService } from './search-service';
import { MENTION_KIND_ORDER } from './kind-order';
import type { MentionCandidate, MentionType, Provider, SearchContext } from './types';

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

    await expect(firstOutcome).resolves.toMatchObject({
      name: 'AbortError',
      message: 'Search cancelled',
    });
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

describe('DebouncedSearchService kind order', () => {
  const candidates = (type: MentionType, count: number, score?: number): MentionCandidate[] =>
    Array.from({ length: count }, (_, i) => ({
      id: `${type}-${i}`,
      label: `${type} ${i}`,
      type,
      uri: `${type}:${i}`,
      score,
    }));
  const providerOf = (id: string, items: MentionCandidate[]): Provider => ({
    id,
    search: async () => items,
  });

  it('ranks by kind before score and caps per kind so no kind is dropped from the tail', async () => {
    const service = new DebouncedSearchService({ typeOrder: MENTION_KIND_ORDER, maxResults: 50 });
    const results = await service.search(
      '',
      [
        providerOf('specialist', candidates('specialist', 10, 0.8)),
        providerOf('terminal', candidates('terminal', 10)),
        providerOf('script', candidates('script', 10)),
        providerOf('folder', candidates('folder', 10)),
        providerOf('file', candidates('file', 18, 0.5)),
        providerOf('agent', candidates('agent', 10, 0.7)),
        providerOf('note', candidates('note', 10)),
      ],
      context,
    );

    const kinds = [...new Set(results.map((r) => r.type))];
    expect(kinds).toEqual(['note', 'agent', 'file', 'folder', 'script', 'terminal', 'specialist']);
    expect(results.filter((r) => r.type === 'note')).toHaveLength(10);
    expect(results.filter((r) => r.type === 'specialist')).toHaveLength(10);
    expect(results).toHaveLength(78);
    service.destroy();
  });

  it('caps a large member roster so later kinds stay visible', async () => {
    const service = new DebouncedSearchService({ typeOrder: MENTION_KIND_ORDER });
    const results = await service.search(
      '',
      [
        providerOf('member', candidates('member', 80, 0.8)),
        providerOf('note', candidates('note', 3)),
        providerOf('specialist', candidates('specialist', 2, 0.8)),
      ],
      context,
    );

    expect(results.filter((r) => r.type === 'member')).toHaveLength(20);
    expect(results.slice(20).map((r) => r.type)).toEqual([
      'note',
      'note',
      'note',
      'specialist',
      'specialist',
    ]);
    service.destroy();
  });

  it('keeps the global cap on the score-only path', async () => {
    const service = new DebouncedSearchService({ maxResults: 5 });
    const results = await service.search(
      '',
      [providerOf('file', candidates('file', 9, 0.5))],
      context,
    );

    expect(results).toHaveLength(5);
    service.destroy();
  });

  it('keeps the kind order while typing, best match first within each kind', async () => {
    const service = new DebouncedSearchService({ typeOrder: MENTION_KIND_ORDER, debounceMs: 0 });
    const results = await service.search(
      'build',
      [
        providerOf('specialist', [
          { id: 'builder', label: 'build', type: 'specialist', uri: 'specialist:builder' },
        ]),
        providerOf('script', [
          { id: 'b-weak', label: 'xbxuxixlxd', type: 'script', uri: 'script:weak' },
          { id: 'b-exact', label: 'build', type: 'script', uri: 'script:exact' },
        ]),
        providerOf('note', [{ id: 'n', label: 'build notes', type: 'note', uri: 'note:build' }]),
      ],
      context,
    );

    expect(results.map((r) => r.id)).toEqual(['n', 'b-exact', 'b-weak', 'builder']);
    service.destroy();
  });

  it('sorts by score alone when no kind order is configured', async () => {
    const service = new DebouncedSearchService();
    const results = await service.search(
      '',
      [
        providerOf('note', candidates('note', 1)),
        providerOf('specialist', candidates('specialist', 1, 0.8)),
      ],
      context,
    );

    expect(results.map((r) => r.type)).toEqual(['specialist', 'note']);
    service.destroy();
  });
});

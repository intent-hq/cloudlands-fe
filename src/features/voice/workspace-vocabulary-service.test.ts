/**
 * Tests for the workspace-vocabulary cache (`voice.getWorkspaceVocabulary`,
 * PROTOCOL §5.41 v5.1): single-flight coalescing per workspace, TTL reuse,
 * and the resilient fetch-failure fallback (resolve [] and retry next time).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getWorkspaceVocabularyMock = vi.fn<(workspaceId: string) => Promise<{ terms: string[] }>>();
vi.mock('$lib/client', () => ({
  appClient: {
    voice: {
      getWorkspaceVocabulary: (workspaceId: string) => getWorkspaceVocabularyMock(workspaceId),
    },
  },
}));

import {
  getWorkspaceVocabularyTerms,
  resetWorkspaceVocabularyCache,
  WORKSPACE_VOCABULARY_TTL_MS,
} from './workspace-vocabulary-service';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  resetWorkspaceVocabularyCache();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('getWorkspaceVocabularyTerms', () => {
  it('fetches via voice.getWorkspaceVocabulary and unwraps the §5.41 { terms } result', async () => {
    getWorkspaceVocabularyMock.mockResolvedValue({ terms: ['intentd', 'clippy'] });

    await expect(getWorkspaceVocabularyTerms('ws-1')).resolves.toEqual(['intentd', 'clippy']);
    expect(getWorkspaceVocabularyMock).toHaveBeenCalledWith('ws-1');
  });

  it('coalesces concurrent calls into one in-flight RPC (single-flight)', async () => {
    let resolveFetch!: (value: { terms: string[] }) => void;
    getWorkspaceVocabularyMock.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const first = getWorkspaceVocabularyTerms('ws-1');
    const second = getWorkspaceVocabularyTerms('ws-1');
    resolveFetch({ terms: ['TOON'] });

    await expect(first).resolves.toEqual(['TOON']);
    await expect(second).resolves.toEqual(['TOON']);
    expect(getWorkspaceVocabularyMock).toHaveBeenCalledTimes(1);
  });

  it('reuses a fresh result within the TTL and refetches after it expires', async () => {
    getWorkspaceVocabularyMock.mockResolvedValue({ terms: ['intentd'] });

    await getWorkspaceVocabularyTerms('ws-1');
    await getWorkspaceVocabularyTerms('ws-1');
    expect(getWorkspaceVocabularyMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(WORKSPACE_VOCABULARY_TTL_MS + 1);
    await getWorkspaceVocabularyTerms('ws-1');
    expect(getWorkspaceVocabularyMock).toHaveBeenCalledTimes(2);
  });

  it('caches per workspace (no cross-workspace sharing)', async () => {
    getWorkspaceVocabularyMock
      .mockResolvedValueOnce({ terms: ['a'] })
      .mockResolvedValueOnce({ terms: ['b'] });

    await expect(getWorkspaceVocabularyTerms('ws-1')).resolves.toEqual(['a']);
    await expect(getWorkspaceVocabularyTerms('ws-2')).resolves.toEqual(['b']);
    expect(getWorkspaceVocabularyMock).toHaveBeenCalledTimes(2);
  });

  it('resolves [] on a failed fetch and retries on the next call (resilient fallback)', async () => {
    getWorkspaceVocabularyMock
      .mockRejectedValueOnce(new Error('daemon predates v5.1'))
      .mockResolvedValueOnce({ terms: ['intentd'] });

    await expect(getWorkspaceVocabularyTerms('ws-1')).resolves.toEqual([]);
    // The failed entry was dropped, so the next dictation retries immediately.
    await expect(getWorkspaceVocabularyTerms('ws-1')).resolves.toEqual(['intentd']);
    expect(getWorkspaceVocabularyMock).toHaveBeenCalledTimes(2);
  });
});

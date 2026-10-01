import type { Provider, SearchContext } from './types';

/** Shared by async search and the synchronous fallback so both observe provider state changes. */
export function searchCacheKey(
  query: string,
  providers: Provider[],
  context: SearchContext,
): string {
  return JSON.stringify({
    query,
    workspaceId: context.workspaceId,
    repoPath: context.repoPath,
    currentFile: context.currentFile,
    currentNote: context.currentNote,
    providers: providers.map((provider) => [provider.id, provider.getCacheKey?.(context)]),
  });
}

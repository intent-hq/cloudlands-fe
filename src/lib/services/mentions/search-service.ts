import { logger } from '$lib/utils/client-logger';
import { fuzzyMatch, pathFuzzyMatch } from './fuzzy-matcher';

/**
 * Debounced Search Service with Caching and Cancellation
 */

import type {
  MentionCandidate,
  Provider,
  SearchContext,
  CachedResult,
  MentionSystemConfig,
} from './types';
import { isValidMentionCandidate } from './types';

export class DebouncedSearchService {
  private searchDebounceTimer: NodeJS.Timeout | null = null;
  private currentAbortController: AbortController | null = null;
  private cache = new Map<string, CachedResult>();
  private config: Required<MentionSystemConfig>;
  private isSearching = false;

  constructor(config: MentionSystemConfig = {}) {
    this.config = {
      debounceMs: config.debounceMs ?? 100,
      maxResults: config.maxResults ?? 50,
      cacheMaxAge: config.cacheMaxAge ?? 30000, // 30 seconds
      enableSemantic: config.enableSemantic ?? false,
      enableLivePreview: config.enableLivePreview ?? true,
      enableCollaboration: config.enableCollaboration ?? false,
    };
  }

  async search(
    query: string,
    providers: Provider[],
    context: SearchContext,
  ): Promise<MentionCandidate[]> {
    // Cancel any pending search
    this.cancelPendingSearch();

    // Check cache first — return immediately, no debounce
    const cacheKey = this.getCacheKey(query, context);
    const cached = this.cache.get(cacheKey);
    if (cached && !this.isCacheExpired(cached)) {
      logger.debug('[SearchService] Returning cached results for:', query);
      return cached.results;
    }

    // Create new abort controller
    this.currentAbortController = new AbortController();
    const signal = this.currentAbortController.signal;

    return new Promise((resolve, reject) => {
      this.isSearching = true;

      const executeSearch = async () => {
        try {
          // Check if cancelled
          if (signal.aborted) {
            this.isSearching = false;
            reject(new Error('Search cancelled'));
            return;
          }

          logger.debug(
            '[SearchService] Searching with providers:',
            providers.map((p) => p.id),
          );

          // Perform parallel searches with all providers
          const results = await Promise.all(
            providers.map((provider) => this.searchWithProvider(provider, query, context, signal)),
          );

          // Combine and deduplicate results
          const combined = this.combineResults(results.flat());

          // Filter out invalid candidates
          const validated = combined.filter((candidate) => isValidMentionCandidate(candidate));

          // Apply fuzzy matching to improve ranking
          const fuzzyMatched = this.applyFuzzyMatching(query, validated);

          // Sort by score
          fuzzyMatched.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

          // Limit results
          const limited = fuzzyMatched.slice(0, this.config.maxResults);

          // Cache results
          this.cache.set(cacheKey, {
            results: limited,
            timestamp: Date.now(),
          });

          logger.debug(`[SearchService] Found ${limited.length} results`);
          this.isSearching = false;
          resolve(limited);
        } catch (error) {
          this.isSearching = false;
          if ((error as Error).name === 'AbortError') {
            reject(new Error('Search cancelled'));
          } else {
            logger.error('[SearchService] Search error:', error);
            reject(error);
          }
        }
      };

      // Skip debounce for the initial empty query (opening the popup) —
      // fire immediately so the list appears without delay.
      // For typed queries, debounce to avoid hammering providers on every keystroke.
      if (!query) {
        executeSearch();
      } else {
        this.searchDebounceTimer = setTimeout(executeSearch, this.config.debounceMs);
      }
    });
  }

  private async searchWithProvider(
    provider: Provider,
    query: string,
    context: SearchContext,
    signal: AbortSignal,
  ): Promise<MentionCandidate[]> {
    try {
      // Pass abort signal to provider
      const enhancedContext = { ...context, signal };
      const results = await provider.search(query, enhancedContext);

      // Score results if provider supports it
      if (provider.scoreRelevance) {
        return results.map((r) => ({
          ...r,
          score: provider.scoreRelevance!(r, context),
        }));
      }

      return results;
    } catch (error) {
      logger.error(`[SearchService] Provider ${provider.id} search failed:`, error);
      return [];
    }
  }

  private combineResults(results: MentionCandidate[]): MentionCandidate[] {
    const seen = new Set<string>();
    const deduplicated: MentionCandidate[] = [];

    for (const result of results) {
      const key = `${result.type}:${result.uri}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(result);
      }
    }

    return deduplicated;
  }

  /**
   * Apply fuzzy matching to refine and re-score results
   * This improves ranking by using VS Code-style fuzzy matching
   */
  private applyFuzzyMatching(
    query: string,
    results: MentionCandidate[],
  ): MentionCandidate[] {
    if (!query || query.length === 0) {
      return results;
    }

    // Apply fuzzy matching to label and subtitle
    const scoredResults = results.map((result) => {
      let fuzzyScore = 0;

      // Try matching against full path (most important for path queries)
      const fullPath = result.meta?.path || result.meta?.fullPath ||
                       (result.subtitle ? `${result.subtitle}/${result.label}` : result.label);
      if (fullPath) {
        const pathMatch = pathFuzzyMatch(query, fullPath);
        if (pathMatch) {
          fuzzyScore = Math.max(fuzzyScore, pathMatch.score * 1.8); // Full path matches are highest weight
        }
      }

      // Try matching against label
      const labelMatch = fuzzyMatch(query, result.label);
      if (labelMatch) {
        fuzzyScore = Math.max(fuzzyScore, labelMatch.score * 1.5); // Label matches are more important
      }

      // Try matching against subtitle
      if (result.subtitle) {
        const subtitleMatch = fuzzyMatch(query, result.subtitle);
        if (subtitleMatch) {
          fuzzyScore = Math.max(fuzzyScore, subtitleMatch.score);
        }
      }

      // Try matching against description
      if (result.description) {
        const descMatch = fuzzyMatch(query, result.description);
        if (descMatch) {
          fuzzyScore = Math.max(fuzzyScore, descMatch.score * 0.5); // Description matches are less important
        }
      }

      return {
        ...result,
        score: fuzzyScore > 0 ? fuzzyScore : result.score ?? 0,
      };
    });

    // Filter out results with no fuzzy match
    const filtered = scoredResults.filter((r) => r.score > 0);

    // If filter removes everything, return original results as fallback
    return filtered.length > 0 ? filtered : results;
  }

  private cancelPendingSearch() {
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = null;
    }

    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }
  }

  private getCacheKey(query: string, context: SearchContext): string {
    // Create a stable cache key from query and relevant context
    const contextKey = {
      workspaceId: context.workspaceId,
      currentFile: context.currentFile,
      currentNote: context.currentNote,
    };
    return `${query}:${JSON.stringify(contextKey)}`;
  }

  private isCacheExpired(cached: CachedResult): boolean {
    return Date.now() - cached.timestamp > this.config.cacheMaxAge;
  }

  clearCache() {
    this.cache.clear();
  }

  isLoading(): boolean {
    return this.isSearching;
  }

  destroy() {
    this.cancelPendingSearch();
    this.clearCache();
  }
}

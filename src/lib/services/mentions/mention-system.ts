/**
 * Main Mention System Service
 * Coordinates all mention functionality
 */

import type {
  MentionCandidate,
  SearchContext,
  MentionSystemConfig,
  Provider,
  Resolver,
  PreviewContent,
  ResolveResult,
} from './types';
import { DebouncedSearchService } from './search-service';
import { providerRegistry } from './providers';
import { BreadcrumbController } from './breadcrumb-controller.svelte';
import { logger } from '$lib/utils/client-logger';

// Constants
const CACHE_TIMEOUT_MS = 5000; // 5 seconds
const MAX_SEARCH_RESULTS = 8;
const MAX_CACHE_SIZE = 100; // Maximum number of cache entries
const CACHE_CLEANUP_TARGET = 50; // Target size after cleanup
const URI_TYPE_REGEX = /^devspace:\/\/[^\/]+\/([^\/]+)/;

// Default mention data
const DEFAULT_NOTES: MentionCandidate[] = [
  {
    id: 'spec',
    label: 'spec',
    type: 'note',
    uri: 'note:spec',
    score: 1,
    description: 'Space specification',
  },
  {
    id: 'plan',
    label: 'plan',
    type: 'note',
    uri: 'note:plan',
    score: 0.95,
    description: 'Implementation plan',
  },
];

const COMMON_FILES: MentionCandidate[] = [
  {
    id: 'readme',
    label: 'README.md',
    type: 'file',
    uri: 'file:README.md',
    score: 0.9,
  },
  {
    id: 'package',
    label: 'package.json',
    type: 'file',
    uri: 'file:package.json',
    score: 0.85,
  },
  {
    id: 'tsconfig',
    label: 'tsconfig.json',
    type: 'file',
    uri: 'file:tsconfig.json',
    score: 0.8,
  },
  {
    id: 'gitignore',
    label: '.gitignore',
    type: 'file',
    uri: 'file:.gitignore',
    score: 0.75,
  },
];

const COMMON_FOLDERS: MentionCandidate[] = [
  { id: 'src', label: 'src', type: 'folder', uri: 'folder:src', score: 0.7 },
  { id: 'lib', label: 'lib', type: 'folder', uri: 'folder:lib', score: 0.65 },
  {
    id: 'components',
    label: 'components',
    type: 'folder',
    uri: 'folder:components',
    score: 0.6,
  },
];

// Type guard for provider with getCachedNotes method
interface ProviderWithCache extends Provider {
  getCachedNotes(): MentionCandidate[];
}

function hasGetCachedNotes(provider: Provider): provider is ProviderWithCache {
  return typeof (provider as any).getCachedNotes === 'function';
}

// LRU cache entry
interface CacheEntry {
  results: MentionCandidate[];
  timestamp: number;
}

/**
 * Main mention system service for managing @ mentions in the application.
 * Coordinates search, resolution, and preview of mentionable entities
 * like files, folders, notes, and custom types.
 *
 * @example
 * ```typescript
 * const mentionSystem = new MentionSystem({
 *   debounceMs: 300,
 *   maxResults: 10
 * });
 *
 * const results = await mentionSystem.search('@file', {
 *   workspaceId: 'workspace-123'
 * });
 * ```
 */
export class MentionSystem {
  private readonly searchService: DebouncedSearchService;
  private readonly breadcrumbController: BreadcrumbController;
  private readonly resolvers: Map<string, Resolver> = new Map();
  private readonly config: MentionSystemConfig;

  // Cache properties with LRU tracking
  private readonly cachedResults: Map<string, CacheEntry> = new Map();

  constructor(config: MentionSystemConfig = {}) {
    this.config = config;
    this.searchService = new DebouncedSearchService(config);
    this.breadcrumbController = new BreadcrumbController();
  }

  /**
   * Search for mention candidates across all registered providers.
   * Performs debounced search with caching and provider filtering.
   *
   * @param query - Search query string (may include @ prefix)
   * @param context - Search context including workspace ID
   * @returns Array of mention candidates sorted by relevance
   * @throws Will log error but return empty array on failure
   * @example
   * ```typescript
   * const candidates = await mentionSystem.search('@README', {
   *   workspaceId: 'workspace-123',
   *   agentId: 'agent-456'
   * });
   * ```
   */
  async search(query: string, context: SearchContext): Promise<MentionCandidate[]> {
    // Validate inputs - allow either workspaceId or repoPath
    if (!context?.workspaceId && !context?.repoPath) {
      logger.error('[MentionSystem] search called without valid context (no workspaceId or repoPath)');
      return [];
    }

    // Sanitize query
    const sanitizedQuery = (query || '').trim();

    // Determine which providers to use
    const providers = this.getProvidersForQuery(sanitizedQuery);

    if (providers.length === 0) {
      logger.debug('[MentionSystem] No providers available for query:', sanitizedQuery);
      return [];
    }

    // Perform debounced search
    try {
      return await this.searchService.search(sanitizedQuery, providers, context);
    } catch (error) {
      logger.error('[MentionSystem] Search failed:', error);
      return [];
    }
  }

  /**
   * Synchronous search for mention candidates (for TipTap compatibility)
   * Uses cached data for immediate response
   */
  searchSync(query: string, context: SearchContext): MentionCandidate[] {
    const queryLower = query.toLowerCase();

    // If no workspaceId and no repoPath, return empty results (no random defaults)
    if (!context?.workspaceId && !context?.repoPath) {
      logger.debug('[MentionSystem] searchSync called without workspaceId or repoPath - returning empty results');
      return [];
    }

    // Generate cache key from either workspaceId or repoPath
    const cacheKeyPrefix = context.workspaceId || context.repoPath || 'default';
    const cacheKey = `${cacheKeyPrefix}:${query}`;
    const now = Date.now();

    // Check cache
    if (this.cachedResults.has(cacheKey)) {
      const entry = this.cachedResults.get(cacheKey);
      if (entry && now - entry.timestamp < CACHE_TIMEOUT_MS) {
        // Move to end for LRU tracking
        this.cachedResults.delete(cacheKey);
        this.cachedResults.set(cacheKey, entry);
        return entry.results;
      }
    }

    // Trigger async update in background
    this.updateCache(query, context).catch((error) => {
      logger.warn('[MentionSystem] Background cache update failed:', error);
    });

    // Return immediate results from providers that support sync search
    const results: MentionCandidate[] = [];

    // Get notes from provider or use defaults
    results.push(...this.getNoteCandidates(queryLower));

    // Add common files
    results.push(...this.filterCandidates(COMMON_FILES, queryLower, 3));

    // Add common folders
    results.push(...this.filterCandidates(COMMON_FOLDERS, queryLower, 2));

    // Sort by score and return top results
    return results.sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, MAX_SEARCH_RESULTS);
  }

  /**
   * Get note candidates from provider or defaults
   */
  private getNoteCandidates(queryLower: string): MentionCandidate[] {
    const noteProvider = providerRegistry.get('note');

    // Type-safe check for getCachedNotes method
    if (noteProvider && hasGetCachedNotes(noteProvider)) {
      try {
        const notes = noteProvider.getCachedNotes() || [];
        return notes
          .filter(
            (note) =>
              !queryLower ||
              (note.label &&
                typeof note.label === 'string' &&
                note.label.toLowerCase().includes(queryLower)),
          )
          .slice(0, 3);
      } catch (error) {
        logger.warn('[MentionSystem] Failed to get cached notes:', error);
      }
    }

    // Return default notes if provider doesn't have cached notes
    return this.filterCandidates(DEFAULT_NOTES, queryLower, 3);
  }

  /**
   * Filter candidates by query
   */
  private filterCandidates(
    candidates: MentionCandidate[],
    queryLower: string,
    limit: number,
  ): MentionCandidate[] {
    if (!queryLower) {
      return candidates.slice(0, limit);
    }

    return candidates.filter((c) => c.label.toLowerCase().includes(queryLower)).slice(0, limit);
  }

  private async updateCache(query: string, context: SearchContext): Promise<void> {
    try {
      // Run async search and update cache
      const results = await this.search(query, context);
      const cacheKeyPrefix = context.workspaceId || context.repoPath || 'default';
      const cacheKey = `${cacheKeyPrefix}:${query}`;

      // Store with timestamp for LRU tracking
      const entry: CacheEntry = {
        results,
        timestamp: Date.now(),
      };

      // Delete and re-add to move to end (LRU)
      this.cachedResults.delete(cacheKey);
      this.cachedResults.set(cacheKey, entry);

      // Also trigger provider cache updates
      const noteProvider = providerRegistry.get('note');
      if (noteProvider) {
        await noteProvider.search(query, context);
      }

      // Clean up old cache entries if too many (LRU eviction)
      if (this.cachedResults.size > MAX_CACHE_SIZE) {
        const entriesToDelete = this.cachedResults.size - CACHE_CLEANUP_TARGET;
        const keysToDelete = Array.from(this.cachedResults.keys()).slice(0, entriesToDelete);

        for (const key of keysToDelete) {
          this.cachedResults.delete(key);
        }

        logger.debug(`[MentionSystem] Cache cleanup: removed ${entriesToDelete} entries`);
      }
    } catch (error) {
      logger.warn('[MentionSystem] Cache update failed:', error);
    }
  }

  /**
   * Get providers based on query
   */
  private getProvidersForQuery(query: string): Provider[] {
    if (!query) {
      return providerRegistry.getDefault();
    }

    // Check if query starts with a trigger
    if (query.startsWith('@')) {
      // Extract trigger more safely
      const spaceIndex = query.indexOf(' ');
      const trigger = spaceIndex > 0 ? query.substring(0, spaceIndex) : query;

      const triggered = providerRegistry.getByTrigger(trigger);
      if (triggered.length > 0) {
        logger.debug('[MentionSystem] Using triggered providers for:', trigger);
        return triggered;
      }
    }

    // Return default providers
    const defaultProviders = providerRegistry.getDefault();
    logger.debug('[MentionSystem] Using default providers, count:', defaultProviders.length);
    return defaultProviders;
  }

  /**
   * Resolve a mention URI to get full details
   */
  async resolve(uri: string): Promise<ResolveResult> {
    // Validate input
    if (!uri || typeof uri !== 'string') {
      logger.warn('[MentionSystem] Invalid URI provided to resolve:', uri);
      return {
        exists: false,
        type: 'file',
        label: 'Invalid URI',
        error: 'Invalid URI provided',
      };
    }

    // Find appropriate resolver
    const resolver = this.findResolver(uri);

    if (!resolver) {
      logger.debug('[MentionSystem] No resolver found for URI:', uri);
      return {
        exists: false,
        type: 'file',
        label: 'Unknown',
        error: `No resolver found for URI: ${uri}`,
      };
    }

    try {
      return await resolver.resolve(uri);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('[MentionSystem] Resolution error:', { uri, error: errorMessage });
      return {
        exists: false,
        type: 'file',
        label: 'Error',
        error: errorMessage,
      };
    }
  }

  /**
   * Get live preview for a mention
   */
  async getPreview(uri: string): Promise<PreviewContent | null> {
    // Validate input
    if (!uri || typeof uri !== 'string') {
      logger.warn('[MentionSystem] Invalid URI provided to getPreview:', uri);
      return null;
    }

    try {
      const result = await this.resolve(uri);
      return result.preview || null;
    } catch (error) {
      logger.error('[MentionSystem] Failed to get preview:', error);
      return null;
    }
  }

  /**
   * Register a custom provider
   */
  registerProvider(provider: Provider): void {
    if (!provider) {
      logger.error('[MentionSystem] Cannot register null/undefined provider');
      return;
    }

    if (!provider.id) {
      logger.error('[MentionSystem] Cannot register provider without id');
      return;
    }

    try {
      providerRegistry.register(provider);
      logger.debug(`[MentionSystem] Registered provider: ${provider.id}`);
    } catch (error) {
      logger.error('[MentionSystem] Failed to register provider:', error);
    }
  }

  /**
   * Register a resolver
   */
  registerResolver(type: string, resolver: Resolver): void {
    if (!type || !resolver) {
      logger.error('[MentionSystem] Cannot register resolver with invalid type or resolver');
      return;
    }

    if (this.resolvers.has(type)) {
      logger.warn(`[MentionSystem] Overwriting existing resolver for type: ${type}`);
    }

    this.resolvers.set(type, resolver);
    logger.debug(`[MentionSystem] Registered resolver for type: ${type}`);
  }

  /**
   * Find resolver for URI
   */
  private findResolver(uri: string): Resolver | undefined {
    // Validate input
    if (!uri || typeof uri !== 'string') {
      return undefined;
    }

    // Try to extract type from devspace:// URI pattern
    const match = uri.match(URI_TYPE_REGEX);
    if (match && match[1]) {
      const type = match[1];
      return this.resolvers.get(type);
    }

    // Try alternative patterns for different URI schemes (e.g., "file:path", "note:id")
    const colonIndex = uri.indexOf(':');
    if (colonIndex > 0 && colonIndex < uri.length - 1) {
      const type = uri.substring(0, colonIndex).toLowerCase();

      // Validate type is reasonable (alphanumeric)
      if (/^[a-z0-9]+$/.test(type)) {
        return this.resolvers.get(type);
      }
    }

    logger.debug(`[MentionSystem] No resolver found for URI pattern: ${uri}`);
    return undefined;
  }

  /**
   * Get breadcrumb controller
   */
  getBreadcrumbController(): BreadcrumbController {
    return this.breadcrumbController;
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.searchService.clearCache();
    this.cachedResults.clear();
    logger.debug('[MentionSystem] All caches cleared');
  }

  /**
   * Destroy and clean up
   */
  destroy(): void {
    try {
      this.searchService.destroy();
      this.breadcrumbController.destroy();
      this.cachedResults.clear();
      this.resolvers.clear();
      logger.debug('[MentionSystem] System destroyed successfully');
    } catch (error) {
      logger.error('[MentionSystem] Error during destroy:', error);
    }
  }
}

// Singleton instance management
let mentionSystemInstance: MentionSystem | null = null;
let instanceConfigHash: string | undefined;

/**
 * Create a simple hash of config for comparison
 */
function getConfigHash(config?: MentionSystemConfig): string {
  return config ? JSON.stringify(config) : 'default';
}

/**
 * Get or create the mention system singleton
 * @param config Configuration for the mention system (only used on first call)
 */
export function getMentionSystem(config?: MentionSystemConfig): MentionSystem {
  const configHash = getConfigHash(config);

  if (!mentionSystemInstance) {
    instanceConfigHash = configHash;
    mentionSystemInstance = new MentionSystem(config);
    logger.debug('[MentionSystem] Created new instance with config:', config);
  } else if (config && configHash !== instanceConfigHash) {
    logger.warn(
      '[MentionSystem] Config provided but instance already exists with different config',
      { current: instanceConfigHash, requested: configHash },
    );
  }
  return mentionSystemInstance;
}

/**
 * Destroy the mention system singleton
 */
export function destroyMentionSystem(): void {
  if (mentionSystemInstance) {
    mentionSystemInstance.destroy();
    mentionSystemInstance = null;
    instanceConfigHash = undefined;
    logger.debug('[MentionSystem] Singleton instance destroyed');
  }
}

/**
 * Reset the mention system with new configuration
 */
export function resetMentionSystem(config?: MentionSystemConfig): MentionSystem {
  destroyMentionSystem();
  return getMentionSystem(config);
}

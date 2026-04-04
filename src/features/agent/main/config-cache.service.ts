/**
 * Config Cache Service (Main Process)
 *
 * Caches agent rules and model configurations to avoid repeated disk reads.
 * Implements TTL-based caching with automatic invalidation.
 * This runs in the main process and has full Node.js/file system access.
 */

import fs from 'fs/promises';
import path from 'path';
import { app } from 'electron';
import type { ModelId } from '../../../shared/types/agent.types';

interface CachedItem<T> {
  data: T;
  timestamp: number;
}

interface ModelConfig {
  id: ModelId;
  name: string;
  provider: string;
  maxTokens?: number;
  temperature?: number;
  available: boolean;
}

// Cache configuration
const CACHE_CONFIG = {
  RULES_TTL: 5 * 60 * 1000, // 5 minutes
  MODEL_TTL: 10 * 60 * 1000, // 10 minutes
  CLEANUP_INTERVAL: 60 * 1000, // 1 minute
  MAX_ENTRIES: 100,
};

export class ConfigCacheService {
  private cache = new Map<string, CachedItem<any>>();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.startCleanupTimer();
  }

  /**
   * Get model configuration from disk or cache
   */
  async getModelConfig(modelId: ModelId): Promise<ModelConfig | null> {
    const cacheKey = `model:${modelId}`;

    // Check cache first
    const cached = this.getFromCache<ModelConfig>(cacheKey, CACHE_CONFIG.MODEL_TTL);
    if (cached !== null) {
      return cached;
    }

    try {
      // Load model config from disk
      const configPath = path.join(app.getPath('userData'), 'models', `${modelId}.json`);
      const configData = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(configData) as ModelConfig;

      // Cache the result
      this.setInCache(cacheKey, config);

      return config;
    } catch {
      // Model config not found
      return null;
    }
  }

  /**
   * Get all available models from disk or cache
   */
  async getAllModels(): Promise<ModelConfig[]> {
    const cacheKey = 'models:all';

    // Check cache first
    const cached = this.getFromCache<ModelConfig[]>(cacheKey, CACHE_CONFIG.MODEL_TTL);
    if (cached !== null) {
      return cached;
    }

    try {
      // Load all model configs from disk
      const modelsDir = path.join(app.getPath('userData'), 'models');

      // Ensure directory exists
      await fs.mkdir(modelsDir, { recursive: true });

      const files = await fs.readdir(modelsDir);
      const modelFiles = files.filter((f) => f.endsWith('.json'));

      const models = await Promise.all(
        modelFiles.map(async (file) => {
          try {
            const configData = await fs.readFile(path.join(modelsDir, file), 'utf-8');
            return JSON.parse(configData) as ModelConfig;
          } catch {
            return null;
          }
        }),
      );

      const validModels = models.filter((m): m is ModelConfig => m !== null);

      // Cache the result
      this.setInCache(cacheKey, validModels);

      return validModels;
    } catch {
      // Return empty array if directory doesn't exist
      return [];
    }
  }

  /**
   * Clear all cached data
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Invalidate a specific cache entry
   */
  invalidate(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Get item from cache if not expired
   */
  private getFromCache<T>(key: string, ttl: number): T | null {
    const cached = this.cache.get(key);

    if (!cached) {
      return null;
    }

    const age = Date.now() - cached.timestamp;
    if (age > ttl) {
      this.cache.delete(key);
      return null;
    }

    return cached.data as T;
  }

  /**
   * Set item in cache
   */
  private setInCache(key: string, data: any): void {
    // Enforce max entries limit
    if (this.cache.size >= CACHE_CONFIG.MAX_ENTRIES) {
      // Remove oldest entry
      const oldestKey = this.findOldestEntry();
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  /**
   * Find the oldest cache entry
   */
  private findOldestEntry(): string | null {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, item] of this.cache.entries()) {
      if (item.timestamp < oldestTime) {
        oldestTime = item.timestamp;
        oldestKey = key;
      }
    }

    return oldestKey;
  }

  /**
   * Start periodic cleanup of expired cache entries
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredEntries();
    }, CACHE_CONFIG.CLEANUP_INTERVAL);
  }

  /**
   * Clean up expired cache entries
   */
  private cleanupExpiredEntries(): void {
    const now = Date.now();
    const maxAge = Math.max(CACHE_CONFIG.RULES_TTL, CACHE_CONFIG.MODEL_TTL);

    for (const [key, item] of this.cache.entries()) {
      if (now - item.timestamp > maxAge) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.cache.clear();
  }
}

// Export singleton instance
export const configCache = new ConfigCacheService();

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
import { createCache, type Cache } from '../../../main/utils/cache';

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
  MAX_ENTRIES: 100,
};

export class ConfigCacheService {
  private cache: Cache<string, unknown> = createCache({
    name: 'config-cache',
    ttlMs: CACHE_CONFIG.RULES_TTL,
    maxSize: CACHE_CONFIG.MAX_ENTRIES,
  });

  /**
   * Get model configuration from disk or cache
   */
  async getModelConfig(modelId: ModelId): Promise<ModelConfig | null> {
    const cacheKey = `model:${modelId}`;

    // Check cache first
    const cached = this.cache.get(cacheKey) as ModelConfig | undefined;
    if (cached !== undefined) {
      return cached;
    }

    try {
      // Load model config from disk
      const configPath = path.join(app.getPath('userData'), 'models', `${modelId}.json`);
      const configData = await fs.readFile(configPath, 'utf-8');
      const config = JSON.parse(configData) as ModelConfig;

      // Cache the result
      this.cache.set(cacheKey, config, { ttlMs: CACHE_CONFIG.MODEL_TTL });

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
    const cached = this.cache.get(cacheKey) as ModelConfig[] | undefined;
    if (cached !== undefined) {
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
      this.cache.set(cacheKey, validModels, { ttlMs: CACHE_CONFIG.MODEL_TTL });

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
   * Cleanup resources
   */
  dispose(): void {
    this.cache.dispose();
  }
}

// Export singleton instance
export const configCache = new ConfigCacheService();

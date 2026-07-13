/**
 * Unified Storage Service
 *
 * Consolidates all storage patterns into a single, consistent interface.
 * Provides multiple storage backends with automatic fallback and migration.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { EventEmitter } from '$shared/utils/event-emitter';
import { Logger } from '../../../shared/logger';
import { fsyncFile } from '../../../shared/main/file-sync-utils';

export enum StorageBackend {
  FILE_SYSTEM = 'file_system',
  LOCAL_STORAGE = 'local_storage',
  INDEXED_DB = 'indexed_db',
  MEMORY = 'memory',
}

export interface StorageOptions {
  backend?: StorageBackend;
  basePath?: string;
  namespace?: string;
  maxSize?: number;
  compression?: boolean;
  encryption?: boolean;
  versioning?: boolean;
  autoMigrate?: boolean;
}

export interface StorageMetadata {
  version: number;
  created: string;
  modified: string;
  size: number;
  checksum?: string;
}

export interface StorageItem<T = any> {
  key: string;
  value: T;
  metadata: StorageMetadata;
}

export interface StorageQuery {
  prefix?: string;
  pattern?: RegExp;
  limit?: number;
  offset?: number;
  orderBy?: 'created' | 'modified' | 'size';
  orderDirection?: 'asc' | 'desc';
}

export abstract class StorageAdapter {
  abstract get(key: string): Promise<any | null>;
  abstract set(key: string, value: any, metadata?: Partial<StorageMetadata>): Promise<void>;
  abstract delete(key: string): Promise<void>;
  abstract exists(key: string): Promise<boolean>;
  abstract list(query?: StorageQuery): Promise<string[]>;
  abstract clear(prefix?: string): Promise<void>;
  abstract getMetadata(key: string): Promise<StorageMetadata | null>;
  abstract getSize(): Promise<number>;
}

/**
 * File System Storage Adapter
 */
export class FileSystemAdapter extends StorageAdapter {
  private basePath: string;
  private logger = new Logger('FileSystemAdapter');

  constructor(options: StorageOptions) {
    super();
    this.basePath = options.basePath || path.join(homedir(), 'intent', '.storage');
  }

  private getFilePath(key: string): string {
    // Sanitize key to prevent path traversal
    const sanitizedKey = key.replace(/[^a-zA-Z0-9-_./]/g, '_');
    return path.join(this.basePath, `${sanitizedKey}.json`);
  }

  async get(key: string): Promise<any | null> {
    try {
      const filePath = this.getFilePath(key);
      const data = await fs.readFile(filePath, 'utf-8');
      const item = JSON.parse(data);
      return item.value;
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async set(key: string, value: any, metadata?: Partial<StorageMetadata>): Promise<void> {
    const filePath = this.getFilePath(key);
    const dir = path.dirname(filePath);

    // Ensure directory exists
    await fs.mkdir(dir, { recursive: true });

    const item: StorageItem = {
      key,
      value,
      metadata: {
        version: metadata?.version || 1,
        created: metadata?.created || new Date().toISOString(),
        modified: new Date().toISOString(),
        size: JSON.stringify(value).length,
        checksum: metadata?.checksum,
      },
    };

    await fs.writeFile(filePath, JSON.stringify(item, null, 2), 'utf-8');

    // Sync file to disk for durability
    await fsyncFile(filePath);
  }

  async delete(key: string): Promise<void> {
    try {
      const filePath = this.getFilePath(key);
      await fs.unlink(filePath);
    } catch (error) {
      if ((error as any).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const filePath = this.getFilePath(key);
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async list(query?: StorageQuery): Promise<string[]> {
    try {
      await fs.mkdir(this.basePath, { recursive: true });
      const files = await fs.readdir(this.basePath);

      let keys = files.filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));

      // Apply query filters
      if (query?.prefix) {
        const prefix = query.prefix;
        keys = keys.filter((k) => k.startsWith(prefix));
      }

      if (query?.pattern) {
        const pattern = query.pattern;
        keys = keys.filter((k) => pattern.test(k));
      }

      // Apply pagination
      if (query?.offset !== undefined && query?.limit !== undefined) {
        // When both offset and limit are provided, slice from offset to offset+limit
        keys = keys.slice(query.offset, query.offset + query.limit);
      } else if (query?.offset !== undefined) {
        // Only offset provided
        keys = keys.slice(query.offset);
      } else if (query?.limit !== undefined) {
        // Only limit provided
        keys = keys.slice(0, query.limit);
      }

      return keys;
    } catch {
      return [];
    }
  }

  async clear(prefix?: string): Promise<void> {
    const keys = await this.list({ prefix });
    await Promise.all(keys.map((key) => this.delete(key)));
  }

  async getMetadata(key: string): Promise<StorageMetadata | null> {
    try {
      const filePath = this.getFilePath(key);
      const data = await fs.readFile(filePath, 'utf-8');
      const item = JSON.parse(data);
      return item.metadata;
    } catch {
      return null;
    }
  }

  async getSize(): Promise<number> {
    try {
      const files = await fs.readdir(this.basePath);
      let totalSize = 0;

      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(this.basePath, file);
          const stats = await fs.stat(filePath);
          totalSize += stats.size;
        }
      }

      return totalSize;
    } catch {
      return 0;
    }
  }
}

/**
 * Memory Storage Adapter (for testing and temporary storage)
 */
export class MemoryAdapter extends StorageAdapter {
  private storage = new Map<string, StorageItem>();

  async get(key: string): Promise<any | null> {
    const item = this.storage.get(key);
    return item?.value || null;
  }

  async set(key: string, value: any, metadata?: Partial<StorageMetadata>): Promise<void> {
    const existing = this.storage.get(key);

    this.storage.set(key, {
      key,
      value,
      metadata: {
        version: metadata?.version || 1,
        created: existing?.metadata.created || new Date().toISOString(),
        modified: new Date().toISOString(),
        size: JSON.stringify(value).length,
        checksum: metadata?.checksum,
      },
    });
  }

  async delete(key: string): Promise<void> {
    this.storage.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.storage.has(key);
  }

  async list(query?: StorageQuery): Promise<string[]> {
    let keys = Array.from(this.storage.keys());

    if (query?.prefix) {
      const prefix = query.prefix;
      keys = keys.filter((k) => k.startsWith(prefix));
    }

    if (query?.pattern) {
      const pattern = query.pattern;
      keys = keys.filter((k) => pattern.test(k));
    }

    if (query?.offset) {
      keys = keys.slice(query.offset);
    }

    if (query?.limit) {
      keys = keys.slice(0, query.limit);
    }

    return keys;
  }

  async clear(prefix?: string): Promise<void> {
    if (prefix) {
      const keys = await this.list({ prefix });
      keys.forEach((key) => this.storage.delete(key));
    } else {
      this.storage.clear();
    }
  }

  async getMetadata(key: string): Promise<StorageMetadata | null> {
    const item = this.storage.get(key);
    return item?.metadata || null;
  }

  async getSize(): Promise<number> {
    let totalSize = 0;
    for (const item of this.storage.values()) {
      totalSize += item.metadata.size;
    }
    return totalSize;
  }
}

/**
 * Unified Storage Service
 */
export class UnifiedStorageService extends EventEmitter {
  private static instance: UnifiedStorageService;
  private logger = new Logger('UnifiedStorage');
  private adapters = new Map<StorageBackend, StorageAdapter>();
  private primaryAdapter: StorageAdapter;
  private fallbackAdapter?: StorageAdapter;

  private constructor(options: StorageOptions = {}) {
    super();

    // Initialize primary adapter
    const backend = options.backend || StorageBackend.FILE_SYSTEM;
    this.primaryAdapter = this.createAdapter(backend, options);
    this.adapters.set(backend, this.primaryAdapter);

    // Initialize fallback adapter (memory)
    this.fallbackAdapter = new MemoryAdapter();
    this.adapters.set(StorageBackend.MEMORY, this.fallbackAdapter);
  }

  static getInstance(options?: StorageOptions): UnifiedStorageService {
    if (!this.instance) {
      this.instance = new UnifiedStorageService(options);
    }
    return this.instance;
  }

  private createAdapter(backend: StorageBackend, options: StorageOptions): StorageAdapter {
    switch (backend) {
      case StorageBackend.FILE_SYSTEM:
        return new FileSystemAdapter(options);
      case StorageBackend.MEMORY:
        return new MemoryAdapter();
      default:
        throw new Error(`Unsupported storage backend: ${backend}`);
    }
  }

  /**
   * Get value from storage with automatic fallback
   */
  async get<T = any>(key: string): Promise<T | null> {
    try {
      const value = await this.primaryAdapter.get(key);
      if (value !== null) {
        this.emit('storage:read', { key, backend: 'primary' });
        return value;
      }

      // Try fallback
      if (this.fallbackAdapter) {
        const fallbackValue = await this.fallbackAdapter.get(key);
        if (fallbackValue !== null) {
          this.emit('storage:read', { key, backend: 'fallback' });
          // Migrate to primary
          await this.primaryAdapter.set(key, fallbackValue);
          return fallbackValue;
        }
      }

      return null;
    } catch (error) {
      this.logger.error(`Failed to get ${key}`, error as Error);

      // Try fallback on error
      if (this.fallbackAdapter) {
        try {
          return await this.fallbackAdapter.get(key);
        } catch {
          return null;
        }
      }

      return null;
    }
  }

  /**
   * Set value in storage with automatic fallback
   */
  async set<T = any>(key: string, value: T, options?: Partial<StorageMetadata>): Promise<void> {
    try {
      await this.primaryAdapter.set(key, value, options);
      this.emit('storage:write', { key, backend: 'primary' });

      // Also set in fallback for redundancy
      if (this.fallbackAdapter) {
        await this.fallbackAdapter.set(key, value, options).catch(() => {});
      }
    } catch (error) {
      this.logger.error(`Failed to set ${key}`, error as Error);

      // Try fallback on error
      if (this.fallbackAdapter) {
        await this.fallbackAdapter.set(key, value, options);
        this.emit('storage:write', { key, backend: 'fallback' });
      } else {
        throw error;
      }
    }
  }

  /**
   * Delete value from storage
   */
  async delete(key: string): Promise<void> {
    try {
      await this.primaryAdapter.delete(key);
      this.emit('storage:delete', { key, backend: 'primary' });

      // Also delete from fallback
      if (this.fallbackAdapter) {
        await this.fallbackAdapter.delete(key).catch(() => {});
      }
    } catch (error) {
      this.logger.error(`Failed to delete ${key}`, error as Error);

      // Try fallback on error
      if (this.fallbackAdapter) {
        await this.fallbackAdapter.delete(key);
        this.emit('storage:delete', { key, backend: 'fallback' });
      }
    }
  }

  /**
   * Check if key exists
   */
  async exists(key: string): Promise<boolean> {
    try {
      const exists = await this.primaryAdapter.exists(key);
      if (exists) return true;

      // Check fallback
      if (this.fallbackAdapter) {
        return await this.fallbackAdapter.exists(key);
      }

      return false;
    } catch {
      if (this.fallbackAdapter) {
        return await this.fallbackAdapter.exists(key);
      }
      return false;
    }
  }

  /**
   * List keys matching query
   */
  async list(query?: StorageQuery): Promise<string[]> {
    try {
      const primaryKeys = await this.primaryAdapter.list(query);

      if (this.fallbackAdapter) {
        const fallbackKeys = await this.fallbackAdapter.list(query);
        // Merge and deduplicate
        const allKeys = new Set([...primaryKeys, ...fallbackKeys]);
        return Array.from(allKeys);
      }

      return primaryKeys;
    } catch (error) {
      this.logger.error('Failed to list keys', error as Error);

      if (this.fallbackAdapter) {
        return await this.fallbackAdapter.list(query);
      }

      return [];
    }
  }

  /**
   * Clear storage
   */
  async clear(prefix?: string): Promise<void> {
    try {
      await this.primaryAdapter.clear(prefix);

      if (this.fallbackAdapter) {
        await this.fallbackAdapter.clear(prefix);
      }

      this.emit('storage:clear', { prefix });
    } catch (error) {
      this.logger.error('Failed to clear storage', error as Error);
      throw error;
    }
  }

  /**
   * Get storage size
   */
  async getSize(): Promise<number> {
    try {
      return await this.primaryAdapter.getSize();
    } catch {
      return 0;
    }
  }

  /**
   * Create namespaced storage
   */
  namespace(namespace: string): NamespacedStorage {
    return new NamespacedStorage(this, namespace);
  }

  /**
   * Batch operations
   */
  async batch(
    operations: Array<{ type: 'get' | 'set' | 'delete'; key: string; value?: any }>,
  ): Promise<any[]> {
    const results: any[] = [];

    for (const op of operations) {
      try {
        switch (op.type) {
          case 'get':
            results.push(await this.get(op.key));
            break;
          case 'set':
            await this.set(op.key, op.value);
            results.push(true);
            break;
          case 'delete':
            await this.delete(op.key);
            results.push(true);
            break;
        }
      } catch (error) {
        results.push(error);
      }
    }

    return results;
  }
}

/**
 * Namespaced Storage Wrapper
 */
export class NamespacedStorage {
  constructor(
    private storage: UnifiedStorageService,
    private namespace: string,
  ) {}

  private prefixKey(key: string): string {
    return `${this.namespace}:${key}`;
  }

  async get<T = any>(key: string): Promise<T | null> {
    return this.storage.get(this.prefixKey(key));
  }

  async set<T = any>(key: string, value: T, options?: Partial<StorageMetadata>): Promise<void> {
    return this.storage.set(this.prefixKey(key), value, options);
  }

  async delete(key: string): Promise<void> {
    return this.storage.delete(this.prefixKey(key));
  }

  async exists(key: string): Promise<boolean> {
    return this.storage.exists(this.prefixKey(key));
  }

  async list(query?: Omit<StorageQuery, 'prefix'>): Promise<string[]> {
    const keys = await this.storage.list({
      ...query,
      prefix: this.namespace,
    });

    // Remove namespace prefix from keys
    return keys.map((k) => k.replace(`${this.namespace}:`, ''));
  }

  async clear(): Promise<void> {
    return this.storage.clear(this.namespace);
  }
}

// Export singleton instance
export const unifiedStorage = UnifiedStorageService.getInstance();

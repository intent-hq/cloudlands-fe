/**
 * Memories Service
 *
 * Manages user memories for context enhancement
 */

import { Logger } from '$shared/logger';
import type { Result } from '$shared/types';

const logger = new Logger('MemoriesService');

export interface Memory {
  id: string;
  content: string;
  category?: string;
  tags?: string[];
  createdAt: Date;
  updatedAt: Date;
  workspaceId?: string;
  metadata?: Record<string, any>;
}

export interface CreateMemoryInput {
  content: string;
  category?: string;
  tags?: string[];
  workspaceId?: string;
  metadata?: Record<string, any>;
}

// In-memory storage for now
const memoriesStore = new Map<string, Memory>();

export class MemoriesService {
  /**
   * List all memories
   */
  async listMemories(workspaceId?: string): Promise<Result<Memory[], string>> {
    try {
      const memories = Array.from(memoriesStore.values());

      // Filter by workspace if provided
      const filtered = workspaceId
        ? memories.filter((m) => m.workspaceId === workspaceId)
        : memories;

      // Sort by most recent first
      filtered.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

      return {
        ok: true,
        data: filtered,
      };
    } catch (error) {
      logger.error('Failed to list memories', error as Error);
      return {
        ok: false,
        error: (error as Error).message || 'Failed to list memories',
      };
    }
  }

  /**
   * Get a specific memory
   */
  async getMemory(id: string): Promise<Result<Memory | null, string>> {
    try {
      const memory = memoriesStore.get(id);
      return {
        ok: true,
        data: memory || null,
      };
    } catch (error) {
      logger.error('Failed to get memory', error as Error, { id });
      return {
        ok: false,
        error: (error as Error).message || 'Failed to get memory',
      };
    }
  }

  /**
   * Create a new memory
   */
  async createMemory(input: CreateMemoryInput): Promise<Result<Memory, string>> {
    try {
      const memory: Memory = {
        id: `mem-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        content: input.content,
        category: input.category,
        tags: input.tags,
        workspaceId: input.workspaceId,
        metadata: input.metadata,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      memoriesStore.set(memory.id, memory);
      logger.info('Created memory', { id: memory.id });

      return {
        ok: true,
        data: memory,
      };
    } catch (error) {
      logger.error('Failed to create memory', error as Error);
      return {
        ok: false,
        error: (error as Error).message || 'Failed to create memory',
      };
    }
  }

  /**
   * Update a memory
   */
  async updateMemory(
    id: string,
    updates: Partial<CreateMemoryInput>,
  ): Promise<Result<Memory, string>> {
    try {
      const existing = memoriesStore.get(id);
      if (!existing) {
        return {
          ok: false,
          error: 'Memory not found',
        };
      }

      const updated: Memory = {
        ...existing,
        ...updates,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: new Date(),
      };

      memoriesStore.set(id, updated);
      logger.info('Updated memory', { id });

      return {
        ok: true,
        data: updated,
      };
    } catch (error) {
      logger.error('Failed to update memory', error as Error, { id });
      return {
        ok: false,
        error: (error as Error).message || 'Failed to update memory',
      };
    }
  }

  /**
   * Delete a memory
   */
  async deleteMemory(id: string): Promise<Result<void, string>> {
    try {
      if (!memoriesStore.has(id)) {
        return {
          ok: false,
          error: 'Memory not found',
        };
      }

      memoriesStore.delete(id);
      logger.info('Deleted memory', { id });

      return {
        ok: true,
        data: undefined,
      };
    } catch (error) {
      logger.error('Failed to delete memory', error as Error, { id });
      return {
        ok: false,
        error: (error as Error).message || 'Failed to delete memory',
      };
    }
  }

  /**
   * Search memories by content or tags
   */
  async searchMemories(query: string, workspaceId?: string): Promise<Result<Memory[], string>> {
    try {
      const memories = Array.from(memoriesStore.values());
      const queryLower = query.toLowerCase();

      const filtered = memories.filter((m) => {
        // Filter by workspace if provided
        if (workspaceId && m.workspaceId !== workspaceId) {
          return false;
        }

        // Search in content
        if (m.content.toLowerCase().includes(queryLower)) {
          return true;
        }

        // Search in tags
        if (m.tags?.some((tag) => tag.toLowerCase().includes(queryLower))) {
          return true;
        }

        // Search in category
        if (m.category?.toLowerCase().includes(queryLower)) {
          return true;
        }

        return false;
      });

      // Sort by relevance (simple: most recent first)
      filtered.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

      return {
        ok: true,
        data: filtered,
      };
    } catch (error) {
      logger.error('Failed to search memories', error as Error, { query });
      return {
        ok: false,
        error: (error as Error).message || 'Failed to search memories',
      };
    }
  }

  /**
   * Get memories as context items for chat
   */
  async getMemoriesAsContext(workspaceId?: string): Promise<Result<any[], string>> {
    try {
      const result = await this.listMemories(workspaceId);
      if (!result.ok) {
        return result;
      }

      const contextItems = result.data.map((memory) => ({
        id: `memory-${memory.id}`,
        type: 'memory',
        label: memory.category || 'Memory',
        content: memory.content,
        description: memory.tags?.join(', ') || undefined,
        metadata: {
          memoryId: memory.id,
          category: memory.category,
          tags: memory.tags,
          ...memory.metadata,
        },
      }));

      return {
        ok: true,
        data: contextItems,
      };
    } catch (error) {
      logger.error('Failed to get memories as context', error as Error);
      return {
        ok: false,
        error: (error as Error).message || 'Failed to get memories as context',
      };
    }
  }

  /**
   * Initialize with default memories
   */
  async initializeDefaults(): Promise<void> {
    // Add some default memories for demonstration
    const defaults: CreateMemoryInput[] = [
      {
        content: 'Prefer TypeScript over JavaScript for new files',
        category: 'Coding Preferences',
        tags: ['typescript', 'preferences'],
      },
      {
        content: 'Use Tailwind CSS for styling in Svelte components',
        category: 'Styling Guidelines',
        tags: ['css', 'tailwind', 'svelte'],
      },
      {
        content: 'Follow the existing code style and patterns in the codebase',
        category: 'Best Practices',
        tags: ['code-style', 'patterns'],
      },
    ];

    for (const memory of defaults) {
      await this.createMemory(memory);
    }
  }
}

// Singleton instance
export const memoriesService = new MemoriesService();

// Initialize with defaults
memoriesService.initializeDefaults().catch((error) => {
  logger.error('Failed to initialize default memories', error);
});

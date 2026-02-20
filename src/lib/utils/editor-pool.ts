/**
 * TipTap Editor Pool
 *
 * PERF: Pools TipTap editor instances to reduce memory usage in long conversations.
 * Instead of creating a new editor for each MarkdownViewer, editors are reused
 * from a pool when available.
 *
 * This significantly reduces memory pressure when displaying many messages,
 * as TipTap editors are relatively heavy objects.
 */

import { Editor, type EditorOptions } from '@tiptap/core';
import { logger } from '$lib/utils/client-logger';

interface PooledEditor {
  editor: Editor;
  inUse: boolean;
  lastUsed: number;
}

// Pool configuration
const MAX_POOL_SIZE = 10; // Maximum editors to keep in pool
const CLEANUP_INTERVAL_MS = 30000; // Clean up unused editors every 30s
const MAX_IDLE_TIME_MS = 60000; // Remove editors idle for more than 60s

class EditorPool {
  private pool: PooledEditor[] = [];
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private extensionsFactory: (() => EditorOptions['extensions']) | null = null;

  /**
   * Set the extensions factory for creating new editors.
   * Must be called before acquiring editors.
   */
  setExtensionsFactory(factory: () => EditorOptions['extensions']) {
    this.extensionsFactory = factory;
  }

  /**
   * Acquire an editor from the pool or create a new one.
   * The editor will be attached to the provided element.
   */
  acquire(element: HTMLElement): Editor | null {
    if (!this.extensionsFactory) {
      logger.warn('EditorPool: Extensions factory not set');
      return null;
    }

    // Start cleanup timer if not running
    if (!this.cleanupTimer) {
      this.startCleanup();
    }

    // Try to find an available editor in the pool
    const available = this.pool.find((p) => !p.inUse);

    if (available) {
      available.inUse = true;
      available.lastUsed = Date.now();

      // Reattach to new element
      try {
        // Create a new view with the same state
        available.editor.setOptions({ element });
        return available.editor;
      } catch (error) {
        logger.debug('EditorPool: Failed to reattach editor, creating new one', { error });
        // Remove failed editor from pool
        this.pool = this.pool.filter((p) => p !== available);
        available.editor.destroy();
      }
    }

    // Create new editor if pool is not full
    if (this.pool.length < MAX_POOL_SIZE) {
      try {
        const editor = new Editor({
          element,
          editable: false,
          content: '',
          extensions: this.extensionsFactory(),
          // Disable the buggy 'delete' core extension that emits delete events.
          // It has a bug where it calls nodeAt(newStart - 1) without checking if newStart is 0,
          // causing "Position -1 outside of fragment" errors.
          enableCoreExtensions: {
            delete: false,
          },
        });

        const pooled: PooledEditor = {
          editor,
          inUse: true,
          lastUsed: Date.now(),
        };
        this.pool.push(pooled);

        logger.debug('EditorPool: Created new editor', { poolSize: this.pool.length });
        return editor;
      } catch (error) {
        logger.error('EditorPool: Failed to create editor', { error });
        return null;
      }
    }

    // Pool is full, create a non-pooled editor
    logger.debug('EditorPool: Pool full, creating non-pooled editor');
    return new Editor({
      element,
      editable: false,
      content: '',
      extensions: this.extensionsFactory(),
      // Disable the buggy 'delete' core extension that emits delete events.
      // It has a bug where it calls nodeAt(newStart - 1) without checking if newStart is 0,
      // causing "Position -1 outside of fragment" errors.
      enableCoreExtensions: {
        delete: false,
      },
    });
  }

  /**
   * Release an editor back to the pool.
   * If the editor is not from the pool, it will be destroyed.
   */
  release(editor: Editor) {
    const pooled = this.pool.find((p) => p.editor === editor);

    if (pooled) {
      pooled.inUse = false;
      pooled.lastUsed = Date.now();
      // Clear content to free memory
      try {
        editor.commands.clearContent();
      } catch {
        // Ignore errors during cleanup
      }
    } else {
      // Not from pool, destroy it
      try {
        editor.destroy();
      } catch {
        // Ignore errors during cleanup
      }
    }
  }

  /**
   * Start periodic cleanup of idle editors.
   */
  private startCleanup() {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      const toRemove: PooledEditor[] = [];

      for (const pooled of this.pool) {
        if (!pooled.inUse && now - pooled.lastUsed > MAX_IDLE_TIME_MS) {
          toRemove.push(pooled);
        }
      }

      for (const pooled of toRemove) {
        try {
          pooled.editor.destroy();
        } catch {
          // Ignore errors during cleanup
        }
        this.pool = this.pool.filter((p) => p !== pooled);
      }

      if (toRemove.length > 0) {
        logger.debug('EditorPool: Cleaned up idle editors', {
          removed: toRemove.length,
          remaining: this.pool.length,
        });
      }
    }, CLEANUP_INTERVAL_MS);
  }

  /**
   * Destroy all editors and stop cleanup.
   */
  destroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    for (const pooled of this.pool) {
      try {
        pooled.editor.destroy();
      } catch {
        // Ignore errors during cleanup
      }
    }
    this.pool = [];
  }

  /**
   * Get pool statistics for debugging.
   */
  getStats() {
    return {
      total: this.pool.length,
      inUse: this.pool.filter((p) => p.inUse).length,
      available: this.pool.filter((p) => !p.inUse).length,
    };
  }
}

// Singleton instance
export const editorPool = new EditorPool();

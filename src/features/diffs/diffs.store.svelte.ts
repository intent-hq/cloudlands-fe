/**
 * Diffs Store
 *
 * Simple state management for diffs using Svelte 5 runes.
 */

import type { DiffChunk, WorkspaceId, Result } from '$shared/types';
import { api } from '$lib/api/client';
import { Logger } from '$shared/logger';

const logger = new Logger('DiffsStore');

class DiffsStore {
  // State
  #diffs = $state<Map<WorkspaceId, DiffChunk[]>>(new Map());
  #loading = $state(false);
  #error: string | null = $state(null);
  #currentWorkspaceId: WorkspaceId | null = $state(null);

  // Getters
  get diffs() {
    return this.#diffs;
  }
  get loading() {
    return this.#loading;
  }
  get error() {
    return this.#error;
  }
  get currentWorkspaceId() {
    return this.#currentWorkspaceId;
  }

  // Derived state
  get currentDiffs() {
    return this.#currentWorkspaceId ? this.#diffs.get(this.#currentWorkspaceId) || [] : [];
  }

  get hasChanges() {
    return this.currentDiffs.length > 0;
  }

  // Alias for backward compatibility
  get hasDiffs() {
    return this.hasChanges;
  }

  // Actions
  setWorkspace(workspaceId: WorkspaceId): void {
    this.#currentWorkspaceId = workspaceId;
  }

  setDiffs(workspaceId: WorkspaceId, diffs: DiffChunk[]): void {
    this.#diffs.set(workspaceId, diffs);
  }

  clearDiffs(workspaceId?: WorkspaceId): void {
    if (workspaceId) {
      this.#diffs.delete(workspaceId);
    } else {
      this.#diffs.clear();
    }
  }

  clearError(): void {
    this.#error = null;
  }

  reset(): void {
    this.#diffs.clear();
    this.#loading = false;
    this.#error = null;
    this.#currentWorkspaceId = null;
  }

  // Load diffs for a workspace
  async loadWorkspaceDiffs(workspaceId: WorkspaceId): Promise<void> {
    this.#loading = true;
    this.#error = null;

    try {
      const diffs = await api.listDiffs(workspaceId);
      this.#diffs.set(workspaceId, diffs);
    } catch (error) {
      this.#error = error instanceof Error ? error.message : 'Failed to load diffs';
      logger.error(
        'Failed to load diffs for workspace',
        error instanceof Error ? error : undefined,
        { workspaceId },
      );
    } finally {
      this.#loading = false;
    }
  }
}

export const diffStore = new DiffsStore();

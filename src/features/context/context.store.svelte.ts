/**
 * Context Store
 *
 * Svelte 5 runes-based store for managing context items per workspace.
 * Context items include Linear issues, GitHub issues, Sentry issues, URLs,
 * and their associations with notes.
 */

import { createLogger } from '$lib/utils/client-logger';
import type { ContextItem, ContextItemType, LinearIssueContextItem, GitHubIssueContextItem, SentryIssueContextItem, BrowserUrlContextItem } from './types';
import { v4 as uuidv4 } from 'uuid';

const logger = createLogger('context-store');

type WorkspaceId = string;
type ContextItemId = string;

interface ContextStoreState {
  items: Map<ContextItemId, ContextItem>;
  loading: boolean;
  error: string | null;
}

class ContextStore {
  // State per workspace
  #stateByWorkspace: Record<WorkspaceId, ContextStoreState> = $state({});
  #currentWorkspaceId: WorkspaceId | null = $state(null);

  // Getters
  get currentWorkspaceId() {
    return this.#currentWorkspaceId;
  }

  get items(): ContextItem[] {
    const state = this.#currentState;
    return state ? Array.from(state.items.values()) : [];
  }

  get loading(): boolean {
    return this.#currentState?.loading ?? false;
  }

  get error(): string | null {
    return this.#currentState?.error ?? null;
  }

  get #currentState(): ContextStoreState | null {
    return this.#currentWorkspaceId ? this.#stateByWorkspace[this.#currentWorkspaceId] : null;
  }

  // Initialize/switch workspace
  setWorkspace(workspaceId: WorkspaceId) {
    this.#currentWorkspaceId = workspaceId;
    if (!this.#stateByWorkspace[workspaceId]) {
      this.#stateByWorkspace[workspaceId] = {
        items: new Map(),
        loading: false,
        error: null,
      };
    }
    this.loadFromStorage(workspaceId);
  }

  // Get items for a specific note (items that have this note as parent)
  getItemsForNote(noteId: string): ContextItem[] {
    return this.items.filter((item) => item.parentNoteId === noteId);
  }

  // Get top-level items (no parent note)
  getTopLevelItems(): ContextItem[] {
    return this.items.filter((item) => !item.parentNoteId);
  }

  // Add a context item
  addItem(item: Omit<ContextItem, 'id' | 'createdAt' | 'updatedAt'>): ContextItem {
    const workspaceId = this.#currentWorkspaceId;
    if (!workspaceId) {
      throw new Error('No workspace selected');
    }

    const now = new Date().toISOString();
    const newItem: ContextItem = {
      ...item,
      id: uuidv4(),
      createdAt: now,
      updatedAt: now,
    } as ContextItem;

    const state = this.#stateByWorkspace[workspaceId];
    if (state) {
      // Create a new Map to trigger Svelte 5 reactivity
      const newItems = new Map(state.items);
      newItems.set(newItem.id, newItem);
      state.items = newItems;
      this.saveToStorage(workspaceId);
    }

    logger.debug('Added context item', { type: item.type, title: item.title });
    return newItem;
  }

  // Remove a context item
  removeItem(itemId: ContextItemId): boolean {
    const workspaceId = this.#currentWorkspaceId;
    if (!workspaceId) return false;

    const state = this.#stateByWorkspace[workspaceId];
    if (state && state.items.has(itemId)) {
      // Create a new Map to trigger Svelte 5 reactivity
      const newItems = new Map(state.items);
      newItems.delete(itemId);
      state.items = newItems;
      this.saveToStorage(workspaceId);
      logger.debug('Removed context item', { itemId });
      return true;
    }
    return false;
  }

  // Update a context item
  updateItem(itemId: ContextItemId, updates: Partial<ContextItem>): ContextItem | null {
    const workspaceId = this.#currentWorkspaceId;
    if (!workspaceId) return null;

    const state = this.#stateByWorkspace[workspaceId];
    const item = state?.items.get(itemId);
    if (item) {
      const updatedItem = { ...item, ...updates, updatedAt: new Date().toISOString() } as ContextItem;
      // Create a new Map to trigger Svelte 5 reactivity
      const newItems = new Map(state.items);
      newItems.set(itemId, updatedItem);
      state.items = newItems;
      this.saveToStorage(workspaceId);
      return updatedItem;
    }
    return null;
  }

  // Associate item with a note
  associateWithNote(itemId: ContextItemId, noteId: string | null): void {
    this.updateItem(itemId, { parentNoteId: noteId ?? undefined });
  }

  // Persistence
  private saveToStorage(workspaceId: WorkspaceId) {
    const state = this.#stateByWorkspace[workspaceId];
    if (!state) return;

    try {
      const key = `workspace:context:${workspaceId}`;
      const data = Array.from(state.items.values());
      localStorage.setItem(key, JSON.stringify(data));
    } catch (error) {
      logger.error('Failed to save context items', { error });
    }
  }

  private loadFromStorage(workspaceId: WorkspaceId) {
    try {
      const key = `workspace:context:${workspaceId}`;
      const stored = localStorage.getItem(key);
      if (stored) {
        const data: ContextItem[] = JSON.parse(stored);
        const state = this.#stateByWorkspace[workspaceId];
        if (state) {
          state.items = new Map(data.map((item) => [item.id, item]));
        }
      }
    } catch (error) {
      logger.error('Failed to load context items', { error });
    }
  }
}

export const contextStore = new ContextStore();

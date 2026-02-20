/**
 * Context Store - Svelte 5 Runes Version
 *
 * Manages context items for agent interactions using Svelte 5 runes
 * instead of the old store pattern.
 */

// Local ContextItem definition
export type ContextItem = {
  id: string;
  type: 'selection' | 'file' | 'note' | 'memory' | 'rule' | string;
  label?: string;
  content?: string;
  path?: string;
  description?: string;
  metadata?: Record<string, any>;
};

interface ContextState {
  items: ContextItem[];
  currentSelection: {
    text: string;
    file?: string;
    language?: string;
    range?: any;
  } | null;
  workspaceId: string | null;
}

class ContextStore {
  // State using Svelte 5 runes
  #state = $state<ContextState>({
    items: [],
    currentSelection: null,
    workspaceId: null,
  });

  // Getters for reactive access
  get items() {
    return this.#state.items;
  }

  get currentSelection() {
    return this.#state.currentSelection;
  }

  get workspaceId() {
    return this.#state.workspaceId;
  }

  // Derived state
  get hasSelection() {
    return !!this.#state.currentSelection?.text?.trim();
  }

  get hasMemories() {
    return this.#state.items.some((item) => item.type === 'memory');
  }

  get hasRules() {
    return this.#state.items.some((item) => item.type === 'rule');
  }

  // Set the current workspace
  setWorkspace(workspaceId: string) {
    this.#state.workspaceId = workspaceId;
    // Clear selection when switching workspaces
    this.#state.currentSelection = null;
    this.#state.items = this.#state.items.filter((item) => item.type !== 'selection');
  }

  // Update the current selection
  setSelection(selection: { text: string; file?: string; language?: string; range?: any } | null) {
    // Remove any existing selection items
    const nonSelectionItems = this.#state.items.filter((item) => item.type !== 'selection');

    if (!selection || !selection.text?.trim()) {
      this.#state.currentSelection = null;
      this.#state.items = nonSelectionItems;
      return;
    }

    // Create new selection item
    const selectionItem: ContextItem = {
      id: `selection-${Date.now()}`,
      type: 'selection',
      label: selection.file
        ? `Selection from ${selection.file.split('/').pop()}`
        : 'Current Selection',
      content: selection.text,
      path: selection.file,
      description: selection.language ? `${selection.language} code` : 'Selected text',
      metadata: {
        range: selection.range,
        language: selection.language,
        autoAdded: true,
      },
    };

    this.#state.currentSelection = selection;
    this.#state.items = [...nonSelectionItems, selectionItem];
  }

  // Add a context item
  addItem(item: ContextItem) {
    // Don't add duplicates
    if (
      this.#state.items.some(
        (existing) => existing.type === item.type && existing.content === item.content,
      )
    ) {
      return;
    }

    this.#state.items = [...this.#state.items, item];
  }

  // Remove a context item
  removeItem(id: string) {
    this.#state.items = this.#state.items.filter((item) => item.id !== id);
  }

  // Clear all context items
  clearAll() {
    this.#state.items = [];
    this.#state.currentSelection = null;
  }

  // Clear items of a specific type
  clearType(type: string) {
    this.#state.items = this.#state.items.filter((item) => item.type !== type);
    if (type === 'selection') {
      this.#state.currentSelection = null;
    }
  }

  // Get items of a specific type
  getItemsByType(type: string) {
    return this.#state.items.filter((item) => item.type === type);
  }
}

// Export singleton instance
export const contextStore = new ContextStore();

// For backward compatibility with components still using the old API
// Export functions that return the current values instead of derived state
export function getSelectionContext() {
  return contextStore.currentSelection;
}

export function getContextItems() {
  return contextStore.items;
}

export function getHasSelection() {
  return contextStore.hasSelection;
}

export function getHasMemories() {
  return contextStore.hasMemories;
}

export function getHasRules() {
  return contextStore.hasRules;
}

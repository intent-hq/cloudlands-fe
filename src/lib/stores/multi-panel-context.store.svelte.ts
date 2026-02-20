/**
 * Multi-Panel Context Store
 *
 * Tracks context across multiple panels for the chat input:
 * - Open panels (files, notes, diffs, etc.) that can be included as context
 * - Text selections across multiple panels (0-n selections)
 *
 * Uses Svelte 5 runes for reactive state management.
 */

import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('multi-panel-context-store');

// ============================================================================
// Types
// ============================================================================

export interface PanelContextItem {
  id: string;
  panelId: string;
  tabId: string;
  type: 'file' | 'note' | 'spec' | 'diff' | 'browser' | 'agent';
  label: string;
  filePath?: string;
  noteId?: string;
  browserUrl?: string;
  agentId?: string;
  checked: boolean;
  /** Whether this tab is the active tab in its panel */
  isActive?: boolean;
}

export interface SelectionContextItem {
  id: string;
  panelId: string;
  tabId: string;
  sourceType: 'file' | 'note';
  sourceLabel: string;
  filePath?: string;
  noteId?: string;
  text: string;
  language?: string;
  checked: boolean;
  /** Timestamp for ordering */
  timestamp: number;
}

interface MultiPanelContextState {
  /** All available panel contexts (non-agent tabs) */
  panels: PanelContextItem[];
  /** All text selections across panels */
  selections: SelectionContextItem[];
  /** ID of the panel containing the current agent (excluded from context list) */
  currentAgentPanelId: string | null;
  /** Workspace ID this store is tracking */
  workspaceId: string | null;
}

// ============================================================================
// Store Implementation
// ============================================================================

class MultiPanelContextStore {
  private static instance: MultiPanelContextStore | null = null;

  // Use $state for reactive properties
  private _state = $state<MultiPanelContextState>({
    panels: [],
    selections: [],
    currentAgentPanelId: null,
    workspaceId: null,
  });

  private constructor() {}

  static getInstance(): MultiPanelContextStore {
    if (!this.instance) {
      this.instance = new MultiPanelContextStore();
    }
    return this.instance;
  }

  // Getters
  get panels(): PanelContextItem[] {
    return this._state.panels;
  }

  get checkedPanels(): PanelContextItem[] {
    return this._state.panels.filter((p) => p.checked);
  }

  get selections(): SelectionContextItem[] {
    return this._state.selections;
  }

  get checkedSelections(): SelectionContextItem[] {
    return this._state.selections.filter((s) => s.checked);
  }

  get hasSelections(): boolean {
    return this._state.selections.length > 0;
  }

  get selectionCount(): number {
    return this._state.selections.length;
  }

  get workspaceId(): string | null {
    return this._state.workspaceId;
  }

  // Actions

  /** Set the workspace this store is tracking */
  setWorkspace(workspaceId: string | null): void {
    if (this._state.workspaceId !== workspaceId) {
      this._state = {
        panels: [],
        selections: [],
        currentAgentPanelId: null,
        workspaceId,
      };
      logger.debug('Workspace changed, cleared context state', { workspaceId });
    }
  }

  /** Set which panel contains the current agent (so we exclude it from context list) */
  setCurrentAgentPanel(panelId: string | null): void {
    this._state.currentAgentPanelId = panelId;
  }

  /** Update the list of available panels from the layout manager */
  updatePanels(panels: PanelContextItem[]): void {
    // Preserve checked state for existing panels
    const checkedIds = new Set(this._state.panels.filter((p) => p.checked).map((p) => p.id));
    const prevCheckedCount = checkedIds.size;
    this._state.panels = panels.map((p) => ({
      ...p,
      checked: checkedIds.has(p.id) || p.checked,
    }));
    const newCheckedCount = this._state.panels.filter((p) => p.checked).length;
    if (prevCheckedCount > 0 || newCheckedCount > 0) {
      logger.info('updatePanels: preserved checked state', {
        prevCheckedCount,
        newCheckedCount,
        checkedIds: Array.from(checkedIds),
        newCheckedIds: this._state.panels.filter((p) => p.checked).map((p) => p.id),
      });
    }
  }

  /** Toggle a panel's checked state */
  togglePanel(id: string): void {
    const panel = this._state.panels.find((p) => p.id === id);
    if (panel) {
      panel.checked = !panel.checked;
      logger.info('Panel toggled', { id, checked: panel.checked, label: panel.label });
    } else {
      logger.warn('Panel not found for toggle', {
        id,
        availablePanelIds: this._state.panels.map((p) => p.id),
      });
    }
  }

  /** Add or update a selection */
  setSelection(selection: Omit<SelectionContextItem, 'id' | 'timestamp' | 'checked'>): void {
    const existingIndex = this._state.selections.findIndex(
      (s) => s.panelId === selection.panelId && s.tabId === selection.tabId,
    );

    const item: SelectionContextItem = {
      ...selection,
      id: `sel-${selection.panelId}-${selection.tabId}`,
      timestamp: Date.now(),
      checked: true, // New selections are checked by default
    };

    if (existingIndex >= 0) {
      // Update existing
      this._state.selections[existingIndex] = item;
    } else {
      // Add new
      this._state.selections.push(item);
    }
    logger.debug('Selection set', { id: item.id, sourceLabel: item.sourceLabel });
  }

  /** Clear a selection by panel/tab */
  clearSelection(panelId: string, tabId: string): void {
    this._state.selections = this._state.selections.filter(
      (s) => !(s.panelId === panelId && s.tabId === tabId),
    );
  }

  /** Clear all selections for a panel (when panel is closed) */
  clearPanelSelections(panelId: string): void {
    this._state.selections = this._state.selections.filter((s) => s.panelId !== panelId);
  }

  /** Toggle a selection's checked state */
  toggleSelection(id: string): void {
    const selection = this._state.selections.find((s) => s.id === id);
    if (selection) {
      selection.checked = !selection.checked;
      logger.debug('Selection toggled', { id, checked: selection.checked });
    }
  }

  /** Remove a selection entirely */
  removeSelection(id: string): void {
    this._state.selections = this._state.selections.filter((s) => s.id !== id);
    logger.debug('Selection removed', { id });
  }

  /** Check all panels */
  checkAllPanels(): void {
    this._state.panels.forEach((p) => (p.checked = true));
  }

  /** Uncheck all panels */
  uncheckAllPanels(): void {
    this._state.panels.forEach((p) => (p.checked = false));
  }

  /** Check all selections */
  checkAllSelections(): void {
    this._state.selections.forEach((s) => (s.checked = true));
  }

  /** Uncheck all selections */
  uncheckAllSelections(): void {
    this._state.selections.forEach((s) => (s.checked = false));
  }

  /** Clear all state */
  clear(): void {
    this._state = {
      panels: [],
      selections: [],
      currentAgentPanelId: null,
      workspaceId: this._state.workspaceId,
    };
    logger.debug('Context store cleared');
  }

  /** Add a searched item as a new panel context (from @ search) */
  addSearchedItem(item: {
    id: string;
    type: PanelContextItem['type'];
    label: string;
    filePath?: string;
    noteId?: string;
  }): void {
    // Check if item already exists
    const existing = this._state.panels.find((p) => p.id === item.id);
    if (existing) {
      // Just check it if it already exists
      existing.checked = true;
      logger.debug('Searched item already exists, checked it', { id: item.id });
      return;
    }

    // Add new item with checked=true
    const newItem: PanelContextItem = {
      id: item.id,
      panelId: 'search', // Special panelId to indicate it came from search
      tabId: item.id,
      type: item.type,
      label: item.label,
      filePath: item.filePath,
      noteId: item.noteId,
      checked: true,
    };
    this._state.panels.push(newItem);
    logger.debug('Added searched item to context', { id: item.id, label: item.label });
  }

  /** Remove a panel from the list (for searched items that user wants to remove) */
  removePanel(id: string): void {
    this._state.panels = this._state.panels.filter((p) => p.id !== id);
    logger.debug('Panel removed', { id });
  }
}

// Export singleton instance
export const multiPanelContextStore = MultiPanelContextStore.getInstance();

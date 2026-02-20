/**
 * Unified tab management for workspaces
 * Handles tab state, persistence, and operations
 */

import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('WorkspaceTabManager');

class WorkspaceTabManager {
  private state = $state({
    openTabs: new Set<string>(),
    currentTabId: null as string | null,
    pinnedTabs: new Set<string>(),
    unsavedTabs: new Set<string>(),
    optimisticTabs: new Set<string>(),
    tabOrder: [] as string[],
    version: 0,
  });

  constructor() {
    this.loadState();
  }

  get openTabs() {
    return this.state.openTabs;
  }

  get currentTabId() {
    return this.state.currentTabId;
  }

  get pinnedTabs() {
    return this.state.pinnedTabs;
  }

  get unsavedTabs() {
    return this.state.unsavedTabs;
  }

  get optimisticTabs() {
    return this.state.optimisticTabs;
  }

  get tabOrder() {
    return this.state.tabOrder;
  }

  get version() {
    return this.state.version;
  }

  openTab(workspaceId: string) {
    let changed = false;

    if (!this.state.openTabs.has(workspaceId)) {
      this.state.openTabs.add(workspaceId);
      this.state.tabOrder.push(workspaceId);
      changed = true;
    }

    if (this.state.currentTabId !== workspaceId) {
      this.state.currentTabId = workspaceId;
      changed = true;
    }

    if (changed) {
      this.state.version++;
      this.saveState();
    }
  }

  closeTab(workspaceId: string) {
    this.state.openTabs.delete(workspaceId);
    this.state.pinnedTabs.delete(workspaceId);
    this.state.unsavedTabs.delete(workspaceId);

    const index = this.state.tabOrder.indexOf(workspaceId);
    if (index > -1) {
      this.state.tabOrder.splice(index, 1);
    }

    if (this.state.currentTabId === workspaceId) {
      // Switch to next tab or previous
      if (this.state.tabOrder.length > 0) {
        const newIndex = Math.min(index, this.state.tabOrder.length - 1);
        this.state.currentTabId = this.state.tabOrder[newIndex];
      } else {
        this.state.currentTabId = null;
      }
    }

    this.state.version++;
    this.saveState();
  }

  clearCurrentTab() {
    // Clear the current tab selection without closing any tabs
    if (this.state.currentTabId !== null) {
      this.state.currentTabId = null;
      this.state.version++;
      this.saveState();
    }
  }

  cleanupInvalidTabs(validIds: Set<string>) {
    // Remove tabs that are no longer valid
    let changed = false;

    // Clean up open tabs
    for (const tabId of this.state.openTabs) {
      if (!validIds.has(tabId) && !this.isOptimisticTab(tabId)) {
        this.state.openTabs.delete(tabId);
        this.state.pinnedTabs.delete(tabId);
        this.state.unsavedTabs.delete(tabId);
        this.state.optimisticTabs.delete(tabId);

        // Remove from tab order
        const index = this.state.tabOrder.indexOf(tabId);
        if (index > -1) {
          this.state.tabOrder.splice(index, 1);
        }

        changed = true;
      }
    }

    // Clear current tab if it's invalid
    if (
      this.state.currentTabId &&
      !validIds.has(this.state.currentTabId) &&
      !this.isOptimisticTab(this.state.currentTabId)
    ) {
      this.state.currentTabId = null;
      changed = true;
    }

    if (changed) {
      this.state.version++;
      this.saveState();
    }
  }

  togglePinTab(workspaceId: string) {
    if (this.state.pinnedTabs.has(workspaceId)) {
      this.state.pinnedTabs.delete(workspaceId);
    } else {
      this.state.pinnedTabs.add(workspaceId);
    }
    this.state.version++;
    this.saveState();
  }

  markUnsaved(workspaceId: string, unsaved: boolean) {
    if (unsaved) {
      this.state.unsavedTabs.add(workspaceId);
    } else {
      this.state.unsavedTabs.delete(workspaceId);
    }
    this.state.version++;
    this.saveState();
  }

  reorderTabs(fromId: string, toId: string) {
    const fromIndex = this.state.tabOrder.indexOf(fromId);
    const toIndex = this.state.tabOrder.indexOf(toId);

    if (fromIndex > -1 && toIndex > -1) {
      // Create a new array to properly trigger Svelte 5 reactivity
      const newOrder = [...this.state.tabOrder];
      newOrder.splice(fromIndex, 1);
      newOrder.splice(toIndex, 0, fromId);
      this.state.tabOrder = newOrder;
      this.state.version++;
      this.saveState();
    }
  }

  // Optimistic tab management
  markAsOptimistic(workspaceId: string) {
    this.state.optimisticTabs.add(workspaceId);
    this.state.version++;
  }

  unmarkAsOptimistic(workspaceId: string) {
    this.state.optimisticTabs.delete(workspaceId);
    this.state.version++;
  }

  isOptimisticTab(workspaceId: string): boolean {
    return this.state.optimisticTabs.has(workspaceId);
  }

  /**
   * Handle transition from optimistic to real workspace ID
   */
  handleOptimisticTransition(optimisticId: string, realId: string) {
    let changed = false;

    // If the optimistic tab was open, replace it with the real one
    if (this.state.openTabs.has(optimisticId)) {
      this.state.openTabs.delete(optimisticId);
      this.state.openTabs.add(realId);
      changed = true;
    }

    // Update tab order
    const index = this.state.tabOrder.indexOf(optimisticId);
    if (index > -1) {
      this.state.tabOrder[index] = realId;
      changed = true;
    }

    // Update current tab if needed
    if (this.state.currentTabId === optimisticId) {
      this.state.currentTabId = realId;
      changed = true;
    }

    // Update pinned tabs if needed
    if (this.state.pinnedTabs.delete(optimisticId)) {
      this.state.pinnedTabs.add(realId);
      changed = true;
    }

    // Update unsaved tabs if needed
    if (this.state.unsavedTabs.delete(optimisticId)) {
      this.state.unsavedTabs.add(realId);
      changed = true;
    }

    // Remove from optimistic tabs
    if (this.state.optimisticTabs.delete(optimisticId)) {
      changed = true;
    }

    if (changed) {
      this.state.version++;
      this.saveState();
    }
  }

  /**
   * Switch to the next tab in the tab order
   */
  switchToNextTab(): string | null {
    if (this.state.tabOrder.length === 0) return null;

    const currentIndex = this.state.currentTabId
      ? this.state.tabOrder.indexOf(this.state.currentTabId)
      : -1;

    const nextIndex = (currentIndex + 1) % this.state.tabOrder.length;
    const nextTabId = this.state.tabOrder[nextIndex];

    if (nextTabId) {
      this.state.currentTabId = nextTabId;
      this.state.version++;
      this.saveState();
    }

    return nextTabId || null;
  }

  /**
   * Switch to the previous tab in the tab order
   */
  switchToPreviousTab(): string | null {
    if (this.state.tabOrder.length === 0) return null;

    const currentIndex = this.state.currentTabId
      ? this.state.tabOrder.indexOf(this.state.currentTabId)
      : -1;

    const prevIndex = currentIndex <= 0 ? this.state.tabOrder.length - 1 : currentIndex - 1;
    const prevTabId = this.state.tabOrder[prevIndex];

    if (prevTabId) {
      this.state.currentTabId = prevTabId;
      this.state.version++;
      this.saveState();
    }

    return prevTabId || null;
  }

  /**
   * Switch to a tab by index
   */
  switchToTabByIndex(index: number): string | null {
    if (index < 0 || index >= this.state.tabOrder.length) return null;

    const tabId = this.state.tabOrder[index];
    if (tabId) {
      this.state.currentTabId = tabId;
      this.state.version++;
      this.saveState();
    }

    return tabId || null;
  }

  private loadState() {
    try {
      const saved = localStorage.getItem('workspace-tabs');
      if (saved) {
        const data = JSON.parse(saved);
        this.state.openTabs = new Set(data.openTabs || []);
        this.state.currentTabId = data.currentTabId || null;
        this.state.pinnedTabs = new Set(data.pinnedTabs || []);
        this.state.unsavedTabs = new Set(data.unsavedTabs || []);
        this.state.optimisticTabs = new Set(data.optimisticTabs || []);
        this.state.tabOrder = data.tabOrder || [];
      }
    } catch (error) {
      logger.error('Failed to load tab state', error);
    }
  }

  private saveState() {
    try {
      const data = {
        openTabs: Array.from(this.state.openTabs),
        currentTabId: this.state.currentTabId,
        pinnedTabs: Array.from(this.state.pinnedTabs),
        unsavedTabs: Array.from(this.state.unsavedTabs),
        optimisticTabs: Array.from(this.state.optimisticTabs),
        tabOrder: this.state.tabOrder,
      };
      localStorage.setItem('workspace-tabs', JSON.stringify(data));
    } catch (error) {
      logger.error('Failed to save tab state', error);
    }
  }
}

export const workspaceTabManager = new WorkspaceTabManager();

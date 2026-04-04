/**
 * Panel Layout Adapter
 *
 * Thin compatibility adapter that wraps Redux panel-layout actions and selectors
 * behind the legacy PanelLayoutManager method interface.
 *
 * Use this to minimize changes in deeply-coupled consumer code.
 * New code should dispatch actions / read selectors directly.
 */

import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
import {
  openTab,
  openTabInAdjacentOrSplit,
  closeTab,
  closeActiveTab,
  closeTabsByType,
  closeTabsByAgentId,
  reopenClosedTab,
  setActiveTab,
  selectNextTab,
  selectPreviousTab,
  reorderTabs,
  moveTabToPanel,
  moveTabToSplit,
  moveTabToSplitLevel,
  closeOtherTabs,
  closeTabsToRight,
  closeAllTabs,
  closeAllOthersEverywhere,
  focusPanel,
  splitPanel,
  closePanel,
  updateSizes,
  updateSplitSizes,
  toggleExpandPanel,
  resetLayout,
  goBack,
  goForward,
  goBackInFocusHistory,
  goForwardInFocusHistory,
  setDeferSpecTab,
  consumePendingFocus,
  reconcileStaleAgentTabs,
  clearPanelLayout,
  updateTabTitle,
  updateTabBrowserUrl,
  updateTabFavicon,
  updateFileTabPath,
  initializeLayout,
  createDefaultLayout,
  applyPreset,
  createGridLayout,
} from '$lib/store/slices/panel-layout/panel-layout-slice';
import {
  selectFocusedPanelId,
  selectPanels,
  selectAllTabs,
  selectPanelIds,
  selectPanel,
} from '$lib/store/slices/panel-layout/panel-layout-selectors';
import type {
  PanelTab,
  PanelTabType,
  PanelState,
  PanelLayoutNode,
  WorkspacePanelLayout,
} from '$lib/store/slices/panel-layout/panel-layout-types';

// Re-export types for backward compatibility
export type { PanelTab, PanelTabType, PanelState, PanelLayoutNode, WorkspacePanelLayout };

/**
 * Adapter that bridges the old PanelLayoutManager method interface to Redux.
 * Instantiate with a workspace ID and call methods just like the old manager.
 */
export class PanelLayoutAdapter {
  constructor(public readonly workspaceId: string) {}

  private get store() { return getReduxStore(); }
  private get state() { return this.store.getState(); }
  private dispatch(action: any) { this.store.dispatch(action); }

  // --- Imperative read methods (for event handlers / one-time reads only) ---

  /** Get all panel IDs. One-time read — not reactive. */
  getPanelIds(): string[] { return selectPanelIds.select(this.state, this.workspaceId); }

  /** Get all tabs across all panels. One-time read — not reactive. */
  getAllTabs(): PanelTab[] { return selectAllTabs.select(this.state, this.workspaceId); }

  /** Get a specific panel by ID. One-time read — not reactive. */
  getPanel(panelId: string): PanelState | null {
    return selectPanel.select(this.state, this.workspaceId, panelId) ?? null;
  }

  /** Get the other panel's ID (when exactly 2 panels exist). One-time read — not reactive. */
  getOtherPanelId(): string | null {
    const ids = this.getPanelIds();
    if (ids.length < 2) return null;
    const focusedId = selectFocusedPanelId.select(this.state, this.workspaceId);
    return ids.find((id) => id !== focusedId) ?? null;
  }

  // --- Tab operations ---
  openTab(tab: Omit<PanelTab, 'id'>, panelId?: string) { this.dispatch(openTab(this.workspaceId, tab, panelId)); }
  openTabInAdjacentOrSplit(tab: Omit<PanelTab, 'id'>, sourcePanelId?: string, options?: { animated?: boolean }) {
    this.dispatch(openTabInAdjacentOrSplit(this.workspaceId, tab, sourcePanelId, options));
  }
  openBrowserPanel(url?: string, contextItemId?: string): void {
    this.openTab({
      type: 'browser',
      title: 'Browser',
      browserUrl: url ?? 'https://google.com',
      contextItemId,
      closable: true,
    });
  }
  closeTab(tabId: string, panelId?: string) { this.dispatch(closeTab(this.workspaceId, tabId, panelId)); }
  closeActiveTab(panelId?: string) { this.dispatch(closeActiveTab(this.workspaceId, panelId)); }
  closeTabsByType(tabType: PanelTabType, matchField?: string, matchValue?: string) {
    this.dispatch(closeTabsByType(this.workspaceId, tabType, matchField, matchValue));
  }
  closeTabsByAgentId(agentId: string) { this.dispatch(closeTabsByAgentId(this.workspaceId, agentId)); }
  reopenClosedTab() { this.dispatch(reopenClosedTab(this.workspaceId)); }
  setActiveTab(tabId: string, panelId?: string) { this.dispatch(setActiveTab(this.workspaceId, tabId, panelId)); }
  selectNextTab(panelId?: string) { this.dispatch(selectNextTab(this.workspaceId, panelId)); }
  selectPreviousTab(panelId?: string) { this.dispatch(selectPreviousTab(this.workspaceId, panelId)); }
  reorderTabs(panelId: string, fromIndex: number, toIndex: number) { this.dispatch(reorderTabs(this.workspaceId, panelId, fromIndex, toIndex)); }
  moveTabToPanel(tabId: string, fromPanelId: string, toPanelId: string, insertIndex?: number) {
    this.dispatch(moveTabToPanel(this.workspaceId, tabId, fromPanelId, toPanelId, insertIndex));
  }
  moveTabToSplit(tabId: string, fromPanelId: string, targetPanelId: string, zone: 'top' | 'bottom' | 'left' | 'right') {
    this.dispatch(moveTabToSplit(this.workspaceId, tabId, fromPanelId, targetPanelId, zone));
  }
  moveTabToSplitLevel(tabId: string, fromPanelId: string, splitPath: number[], position: 'before' | 'after', direction: 'horizontal' | 'vertical') {
    this.dispatch(moveTabToSplitLevel(this.workspaceId, tabId, fromPanelId, splitPath, position, direction));
  }
  closeOtherTabs(tabId: string, panelId?: string) { this.dispatch(closeOtherTabs(this.workspaceId, tabId, panelId)); }
  closeTabsToRight(tabId: string, panelId?: string) { this.dispatch(closeTabsToRight(this.workspaceId, tabId, panelId)); }
  closeAllTabs(panelId?: string) { this.dispatch(closeAllTabs(this.workspaceId, panelId)); }
  closeAllOthersEverywhere(tabId: string, panelId?: string) {
    this.dispatch(closeAllOthersEverywhere(this.workspaceId, tabId, panelId));
  }
  updateTabTitle(tabId: string, title: string) { this.dispatch(updateTabTitle(this.workspaceId, tabId, title)); }
  updateTabBrowserUrl(tabId: string, url: string) { this.dispatch(updateTabBrowserUrl(this.workspaceId, tabId, url)); }
  updateTabFavicon(tabId: string, url: string) { this.dispatch(updateTabFavicon(this.workspaceId, tabId, url)); }
  updateFileTabPath(oldPath: string, newPath: string) { this.dispatch(updateFileTabPath(this.workspaceId, oldPath, newPath)); }

  // --- Panel operations ---
  focusPanel(panelId: string) { this.dispatch(focusPanel(this.workspaceId, panelId)); }
  splitPanel(panelId: string, direction: 'horizontal' | 'vertical', options?: { animated?: boolean }) {
    this.dispatch(splitPanel(this.workspaceId, panelId, direction, options));
  }
  closePanel(panelId: string) { this.dispatch(closePanel(this.workspaceId, panelId)); }
  updateSizes(nodePath: number[], sizes: number[]) { this.dispatch(updateSizes(this.workspaceId, nodePath, sizes)); }
  updateSplitSizes(sizes: number[], splitPath?: number[]) { this.dispatch(updateSplitSizes(this.workspaceId, sizes, splitPath)); }
  toggleExpandPanel(panelId: string) { this.dispatch(toggleExpandPanel(this.workspaceId, panelId)); }
  resetLayout() { this.dispatch(resetLayout(this.workspaceId)); }
  applyPreset(preset: 'single' | 'split-horizontal' | 'split-vertical' | 'three-column') {
    this.dispatch(applyPreset(this.workspaceId, preset));
  }

  // --- History ---
  goBack() { this.dispatch(goBack(this.workspaceId)); }
  goForward() { this.dispatch(goForward(this.workspaceId)); }
  goBackInFocusHistory() { this.dispatch(goBackInFocusHistory(this.workspaceId)); }
  goForwardInFocusHistory() { this.dispatch(goForwardInFocusHistory(this.workspaceId)); }

  // --- Misc ---
  setDeferSpecTab(value: boolean) { this.dispatch(setDeferSpecTab(this.workspaceId, value)); }
  consumePendingFocus(tabId: string) { this.dispatch(consumePendingFocus(this.workspaceId, tabId)); }
  reconcileStaleAgentTabs(validAgentIds: string[] | Set<string>, replacementAgentId: string, replacementTitle: string) {
    const ids = Array.isArray(validAgentIds) ? validAgentIds : Array.from(validAgentIds);
    this.dispatch(reconcileStaleAgentTabs(this.workspaceId, ids, replacementAgentId, replacementTitle));
  }
  clearLayout() { this.dispatch(clearPanelLayout(this.workspaceId)); }

  // --- Grid & Batch ---
  createGridLayout(panelCount: number): string[] {
    this.dispatch(createGridLayout(this.workspaceId, panelCount));
    // After dispatch, read back the panel IDs from state
    return this.getPanelIds();
  }

  batchMutations<T>(fn: () => T): T {
    // In Redux, each dispatch is synchronous and atomic.
    // batchMutations just calls fn — no special batching needed.
    return fn();
  }

  // --- Initialization ---
  initializeLayout(layout?: Pick<any, 'root' | 'panels' | 'focusedPanelId'>) {
    const l = layout ?? createDefaultLayout();
    this.dispatch(initializeLayout(this.workspaceId, l));
  }

  cyclePresets() {
    const panels = selectPanels.select(this.state, this.workspaceId);
    const panelCount = Object.keys(panels).length;
    if (panelCount <= 1) {
      this.applyPreset('split-horizontal');
    } else if (panelCount === 2) {
      this.applyPreset('three-column');
    } else {
      this.applyPreset('single');
    }
  }
}

// ============================================================================
// Factory & Registry  (drop-in replacement for the old getPanelLayoutManager)
// ============================================================================

const adapters = new Map<string, PanelLayoutAdapter>();

/** Get or create a PanelLayoutAdapter for a workspace */
export function getPanelLayoutManager(workspaceId: string): PanelLayoutAdapter {
  let adapter = adapters.get(workspaceId);
  if (!adapter) {
    adapter = new PanelLayoutAdapter(workspaceId);
    adapters.set(workspaceId, adapter);
  }
  return adapter;
}

/** Check if a layout adapter exists (always true — adapters are created on demand) */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function hasPanelLayoutManager(_workspaceId: string): boolean {
  return true; // Adapters are lazy; state lives in Redux
}

/** Create a new layout adapter for a workspace (initializes Redux state) */
export function createPanelLayoutManager(workspaceId: string): PanelLayoutAdapter {
  const adapter = getPanelLayoutManager(workspaceId);
  adapter.initializeLayout();
  return adapter;
}

/** Remove a layout adapter from the registry */
export function clearPanelLayoutAdapter(workspaceId: string) {
  adapters.delete(workspaceId);
}

/** Standalone clearPanelLayout function for backward compat with dynamic imports */
export function clearPanelLayoutForWorkspace(workspaceId: string) {
  getReduxStore().dispatch(clearPanelLayout(workspaceId));
}

// Re-export the action as clearPanelLayout for backward compat
export { clearPanelLayoutForWorkspace as clearPanelLayoutFn };

// Re-export the adapter type as PanelLayoutManager for compatibility
export type PanelLayoutManager = PanelLayoutAdapter;
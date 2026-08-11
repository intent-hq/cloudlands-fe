/**
 * Panel Context - Provides panel ID to all child components
 *
 * This is a more robust alternative to DOM traversal with closest('[data-panel-id]')
 * because it works even when components are rendered through portals or in
 * complex DOM structures.
 *
 * Usage:
 * - In Panel.svelte: setContext(PANEL_CONTEXT_KEY, { panelId: panel.id })
 * - In child components: const ctx = getContext<PanelContext>(PANEL_CONTEXT_KEY)
 */

import { getContext, setContext } from 'svelte';

export const PANEL_CONTEXT_KEY = Symbol('panel-context');

export interface PanelContext {
  /** The ID of the panel this component is rendered in */
  panelId: string;
}

/**
 * Set the panel context for child components
 * Should be called in Panel.svelte during initialization
 */
export function setPanelContext(panelId: string): void {
  setContext<PanelContext>(PANEL_CONTEXT_KEY, { panelId });
}

/**
 * Get the panel context from a parent Panel component
 * Returns undefined if not inside a panel
 */
export function getPanelContext(): PanelContext | undefined {
  try {
    return getContext<PanelContext>(PANEL_CONTEXT_KEY);
  } catch {
    // getContext throws if called outside component initialization
    // or if no context is set
    return undefined;
  }
}

/**
 * Get the current panel ID from DOM traversal
 * Used in click handlers when Svelte context is not available
 *
 * @param event - Mouse event to use for DOM traversal
 * @returns The panel ID or undefined if not in a panel
 */
export function getPanelIdFromEvent(event: MouseEvent): string | undefined {
  if (event?.target) {
    const panelElement = (event.target as HTMLElement)?.closest('[data-panel-id]');
    return panelElement?.getAttribute('data-panel-id') ?? undefined;
  }
  return undefined;
}

/**
 * Helper to create navigation detail with panel context. Navigation originating
 * inside a panel always opens adjacent; modifier-click retains that behavior for
 * callers outside a panel.
 *
 * @param event - The mouse click event
 * @param panelContext - Optional Svelte panel context (from getPanelContext())
 * @returns Object with sourcePanelId and openInAdjacentPanel
 */
export function getNavigationContext(
  event: MouseEvent,
  panelContext?: PanelContext,
): { sourcePanelId?: string; openInAdjacentPanel: boolean } {
  // Try Svelte context first (most reliable), then DOM traversal
  const sourcePanelId = panelContext?.panelId ?? getPanelIdFromEvent(event);
  const openInAdjacentPanel = sourcePanelId !== undefined || event.metaKey || event.ctrlKey;

  return { sourcePanelId, openInAdjacentPanel };
}

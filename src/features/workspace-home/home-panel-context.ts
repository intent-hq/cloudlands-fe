/**
 * Context a home-gated panel (`WorkspaceHomePanelGate`) gives the tab it
 * wraps. A tab that shows editable content reports once that content has
 * loaded, so the gate never remounts it to retry: a remount would drop the
 * editor's undo history and selection (see `nextHomeRetry`).
 */
import { getContext, setContext } from 'svelte';

export interface HomePanelContext {
  /** The panel loaded its content from the home; never remount it to retry. */
  markContentLoaded(): void;
}

const KEY = Symbol('workspace-home-panel');

export function setHomePanelContext(context: HomePanelContext): void {
  setContext(KEY, context);
}

/** The enclosing gate's context, or undefined outside a gated panel. */
export function getHomePanelContext(): HomePanelContext | undefined {
  return getContext<HomePanelContext | undefined>(KEY);
}

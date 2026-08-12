/**
 * Panel Header Context
 *
 * Allows content components to register header actions and info
 * that will be displayed in the Panel's content header.
 */

import { getContext, setContext, untrack } from 'svelte';
import type { Snippet } from 'svelte';
import type { IconDefinition } from '@fortawesome/fontawesome-common-types';

const PANEL_HEADER_CONTEXT_KEY = Symbol('panel-header-context');

export interface PanelHeaderState {
  /** Override the tab title */
  title?: string;
  /** Subtitle to show below title */
  subtitle?: string;
  /** Whether the title is editable */
  editableTitle?: boolean;
  /** Callback when title changes */
  onTitleChange?: (newTitle: string) => void;
  /** Custom icon override */
  icon?: IconDefinition;
  /** Whether content has unsaved changes */
  isDirty?: boolean;
  /** Whether content is currently saving */
  isSaving?: boolean;
}

export interface PanelHeaderActions {
  /** Presentation and view controls shown in the Display section. */
  display?: Snippet;
  /** Commands that act on the current content shown in the Actions section. */
  actions?: Snippet;
}

export interface PanelHeaderContext {
  /** Register header state from content component */
  registerState: (state: PanelHeaderState) => void;
  /** Register content-specific items for the panel's grouped action menu. */
  registerActions: (actions: PanelHeaderActions) => void;
  /** Unregister when component unmounts */
  unregister: () => void;
}

/** Create and set the panel header context */
export function createPanelHeaderContext(): {
  context: PanelHeaderContext;
  state: { current: PanelHeaderState | null };
  actions: { current: PanelHeaderActions | null };
} {
  const state = $state<{ current: PanelHeaderState | null }>({ current: null });
  const actions = $state<{ current: PanelHeaderActions | null }>({ current: null });

  const context: PanelHeaderContext = {
    registerState(newState: PanelHeaderState) {
      if (untrack(() => state.current) !== newState) {
        state.current = newState;
      }
    },
    registerActions(newActions: PanelHeaderActions) {
      if (untrack(() => actions.current) !== newActions) {
        actions.current = newActions;
      }
    },
    unregister() {
      // Direct assignment is safe from $effect since effects run after render
      state.current = null;
      actions.current = null;
    },
  };

  setContext(PANEL_HEADER_CONTEXT_KEY, context);

  return { context, state, actions };
}

/** Get the panel header context (for content components to use) */
export function getPanelHeaderContext(): PanelHeaderContext | null {
  return getContext<PanelHeaderContext>(PANEL_HEADER_CONTEXT_KEY) ?? null;
}

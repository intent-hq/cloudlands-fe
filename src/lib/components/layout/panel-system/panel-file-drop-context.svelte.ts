/**
 * Panel File Drop Context
 *
 * Lets tab content (ChatPanel) register an OS-file drop handler with its
 * surrounding Panel so the panel header (tab bar / agent name row) becomes
 * part of the content's drop target. Content registers while it is the
 * active tab and unregisters on deactivate/destroy; the Panel only accepts
 * header file drops while a handler is registered, so non-agent tabs gain
 * no file-drop behavior.
 */

import { getContext, setContext } from 'svelte';
import type { DropSplit } from '$lib/utils/drop-split';

const PANEL_FILE_DROP_CONTEXT_KEY = Symbol('panel-file-drop-context');

export interface PanelFileDropHandler {
  /**
   * Called with the payload dropped on the panel header, split into files
   * and folders at drop time (never both empty).
   */
  onDrop: (drop: DropSplit) => void;
  /** Called when the file-drag-over-header state flips (drives the overlay). */
  onDragChange: (dragging: boolean) => void;
}

export interface PanelFileDropContext {
  /** Register the active tab's file-drop handler. */
  register: (handler: PanelFileDropHandler) => void;
  /** Unregister; a no-op unless `handler` is the currently registered one. */
  unregister: (handler: PanelFileDropHandler) => void;
}

/** Create and set the panel file-drop context (called by Panel.svelte). */
export function createPanelFileDropContext(): {
  context: PanelFileDropContext;
  handler: { readonly current: PanelFileDropHandler | null };
} {
  // $state.raw keeps the stored handler's raw identity (a deep $state would
  // proxy it, so unregister's `===` against the caller's original handler
  // could never match) while reassignment stays reactive for Panel's effects.
  let current = $state.raw<PanelFileDropHandler | null>(null);

  const context: PanelFileDropContext = {
    register(newHandler: PanelFileDropHandler) {
      current = newHandler;
    },
    unregister(oldHandler: PanelFileDropHandler) {
      // Identity-checked so a late cleanup from a deactivated tab cannot
      // clobber the handler the newly active tab just registered.
      if (current === oldHandler) {
        current = null;
      }
    },
  };

  setContext(PANEL_FILE_DROP_CONTEXT_KEY, context);

  return {
    context,
    handler: {
      get current() {
        return current;
      },
    },
  };
}

/** Get the panel file-drop context (null outside a panel). */
export function getPanelFileDropContext(): PanelFileDropContext | null {
  return getContext<PanelFileDropContext>(PANEL_FILE_DROP_CONTEXT_KEY) ?? null;
}

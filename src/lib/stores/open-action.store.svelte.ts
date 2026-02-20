/**
 * Open Action Store
 *
 * Persists the last selected open action for the OpenComboButton
 * across all instances in the app.
 *
 * Now supports dynamic editor IDs from the installed editors store.
 * Special actions 'copy' and 'copy-branch' are always available.
 */

const STORAGE_KEY = 'open-combo-button-last-action';

/**
 * Open action can be any editor ID from the registry, or special actions.
 * Using string type to support dynamic editors from auto-detection.
 */
export type OpenAction = string;

/** Special non-editor actions that are always available */
export const SPECIAL_ACTIONS = ['copy', 'copy-branch'] as const;
export type SpecialAction = (typeof SPECIAL_ACTIONS)[number];

const DEFAULT_ACTION: OpenAction = 'vscode';

function loadAction(): OpenAction {
  if (typeof window === 'undefined') return DEFAULT_ACTION;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return stored;
    }
  } catch {
    // Ignore parse errors
  }
  return DEFAULT_ACTION;
}

function saveAction(action: OpenAction) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, action);
  } catch {
    // Ignore storage errors
  }
}

function createOpenActionStore() {
  let action = $state<OpenAction>(loadAction());

  return {
    get action() {
      return action;
    },
    set action(value: OpenAction) {
      action = value;
      saveAction(action);
    },
    /** Check if action is a special (non-editor) action */
    isSpecialAction(value: string): value is SpecialAction {
      return SPECIAL_ACTIONS.includes(value as SpecialAction);
    },
  };
}

export const openActionStore = createOpenActionStore();

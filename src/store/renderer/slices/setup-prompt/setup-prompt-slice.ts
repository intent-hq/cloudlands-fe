/**
 * Setup Prompt Slice
 *
 * Actions + reducer for the backend-aware setup gate. The saga evaluates the
 * connected backend's state (workspaces + provider readiness) after every
 * (re)connect and stores the result here. The UI derives from it:
 * - local backend + setup needed → silent redirect to the setup wizard
 * - remote backend + setup needed → explicit "Go through setup?" prompt with
 *   session-scoped dismissal per connection
 */

import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import type { SetupEvaluation, SetupPromptState } from './setup-prompt-types';

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export const initialState: SetupPromptState = {
  evaluation: null,
  dismissedConnectionIds: [],
  bootRouteGateResolved: false,
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Saga trigger: re-evaluate the active backend's setup state. Dispatched on
 * every backend `connected` status (boot and reconnect).
 */
export const evaluateSetupStateRequested = createAction('setupPrompt/evaluateRequested');

/** An evaluation resolved. Replaces any previous evaluation. */
export const setupEvaluationCompleted = createAction<[evaluation: SetupEvaluation]>(
  'setupPrompt/evaluationCompleted',
);

/**
 * User declined (or accepted — either way, stop prompting) the setup prompt
 * for a remote connection this session.
 */
export const setupPromptDismissed = createAction<[connectionId: string]>(
  'setupPrompt/promptDismissed',
);

/**
 * The boot-route gate decided where this page load should land (redirect to
 * an existing workspace, or stay on onboarding/creation). Once resolved,
 * WorkspaceSurface stops holding the onboarding render and later evaluation
 * changes never re-route the window.
 */
export const bootRouteGateResolved = createAction('setupPrompt/bootRouteGateResolved');

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export const setupPromptReducer = createReducer<SetupPromptState>(initialState);

setupPromptReducer.with(setupEvaluationCompleted, (state, { payload: [evaluation] }) => ({
  ...state,
  evaluation,
}));

setupPromptReducer.with(setupPromptDismissed, (state, { payload: [connectionId] }) => {
  if (state.dismissedConnectionIds.includes(connectionId)) return state;
  return {
    ...state,
    dismissedConnectionIds: [...state.dismissedConnectionIds, connectionId],
  };
});

setupPromptReducer.with(bootRouteGateResolved, (state) =>
  state.bootRouteGateResolved ? state : { ...state, bootRouteGateResolved: true },
);

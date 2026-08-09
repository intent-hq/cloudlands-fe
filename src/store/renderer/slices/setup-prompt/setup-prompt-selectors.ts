/**
 * Setup Prompt Selectors
 */

import { getItem } from '@augmentcode/themis/utils/collections/collection-utils';
import { store } from '../../store';
import type { SetupEvaluation } from './setup-prompt-types';

/** Latest completed evaluation, or null until the first one resolves. */
export const selectSetupEvaluation = store.createSelector(
  (state) => state.setupPrompt.evaluation,
);

/**
 * The evaluation for the CURRENTLY-ACTIVE backend, or null. Gated on the
 * active connection id so a stale evaluation from a previous backend never
 * drives the gate after a switch.
 */
export const selectActiveSetupEvaluation = store.createSelector(
  (state): SetupEvaluation | null => {
    const { evaluation } = state.setupPrompt;
    return evaluation && evaluation.connectionId === state.connections.activeId
      ? evaluation
      : null;
  },
);

/**
 * True when the remote-backend "Go through setup?" prompt should show: the
 * active backend is remote, its evaluation found no workspaces and no ready
 * providers, and the user has not dismissed the prompt for this connection
 * this session.
 */
export const selectShowRemoteSetupPrompt = store.createSelector((state) => {
  const evaluation = selectActiveSetupEvaluation.select(state);
  if (!evaluation || evaluation.isLocal || !evaluation.setupNeeded) return false;
  return !state.setupPrompt.dismissedConnectionIds.includes(evaluation.connectionId);
});

/**
 * First-run gate for the LOCAL backend. Drives the silent redirect to the
 * setup wizard and the home page's anti-flash rendering holds:
 * - 'none'     — no redirect will happen; render the home page normally.
 * - 'pending'  — undecided (workspaces/providers still loading on an empty
 *                local backend); hold rendering so the wizard redirect does
 *                not flash the home page first.
 * - 'redirect' — the local backend has no workspaces and no ready providers;
 *                redirect to the setup wizard.
 */
export const selectLocalSetupGate = store.createSelector(
  (state): 'none' | 'pending' | 'redirect' => {
    const { connections, activeId } = state.connections;
    const active = getItem(connections, activeId);
    if (active && !active.isLocal) return 'none';
    if (state.workspace.hasLoaded && state.workspace.workspaces.ids.length > 0) return 'none';
    const evaluation = selectActiveSetupEvaluation.select(state);
    if (!evaluation) return 'pending';
    return evaluation.setupNeeded ? 'redirect' : 'none';
  },
);

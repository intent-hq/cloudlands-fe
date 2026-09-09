/**
 * Setup Prompt Selectors
 */

import { store } from '../../store';
import { selectWorkspaceItems } from '../workspace/workspace-selectors';
import type { SetupEvaluation } from './setup-prompt-types';
import { hasReadyProvider } from './setup-prompt-utils';

/** Latest completed evaluation, or null until the first one resolves. */
export const selectSetupEvaluation = store.createSelector((state) => state.setupPrompt.evaluation);

/** True once this page load's boot-route gate decision has been made. */
export const selectBootRouteGateResolved = store.createSelector(
  (state) => state.setupPrompt.bootRouteGateResolved,
);

/**
 * The evaluation for THIS WINDOW's backend, or null. Gated on the
 * window-scoped backend id (the saga stamps evaluations with the same id) so
 * a stale evaluation from a previous backend never drives the gate after a
 * switch, and a window opened on a non-active backend still sees its own
 * first-run result.
 */
export const selectActiveSetupEvaluation = store.createSelector((state): SetupEvaluation | null => {
  const { evaluation } = state.setupPrompt;
  return evaluation && evaluation.connectionId === state.connections.windowBackendId
    ? evaluation
    : null;
});

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
 * First-run gate for the ACTIVE backend (local or remote). Drives the silent
 * redirect to the setup wizard and the home page's anti-flash rendering holds:
 * - 'none'     — no redirect will happen; render the home page normally.
 * - 'pending'  — undecided (workspaces/providers still loading on an empty
 *                backend); hold rendering so the wizard redirect does not
 *                flash the home page first.
 * - 'redirect' — the active backend has no workspaces and no ready providers;
 *                redirect to the setup wizard (provider setup).
 */
export const selectBackendSetupGate = store.createSelector(
  (state): 'none' | 'pending' | 'redirect' => {
    // Same workspace count the saga evaluates (selectWorkspaceItems excludes
    // the chief workspace), so the gate and the evaluation never disagree.
    if (state.workspace.hasLoaded && selectWorkspaceItems.select(state).length > 0) return 'none';
    // A known-ready provider already means no setup is needed — resolve
    // immediately instead of holding the home page blank for the duration of
    // the bulk provider check (whose per-provider auth checks can take
    // seconds).
    if (hasReadyProvider(state.agentAvailability.providerStatusMap)) return 'none';
    const evaluation = selectActiveSetupEvaluation.select(state);
    if (!evaluation) return 'pending';
    return evaluation.setupNeeded ? 'redirect' : 'none';
  },
);

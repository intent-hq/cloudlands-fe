/**
 * Setup Prompt Types
 *
 * Types for the backend-aware setup gate. Safe to import from any process.
 */

/**
 * Result of evaluating whether the active backend needs first-run setup
 * (no workspaces and no ready providers). Stamped with the connection it
 * was evaluated against so a stale evaluation is never applied to a
 * different backend.
 */
export interface SetupEvaluation {
  /** Connection id the evaluation ran against. */
  connectionId: string;
  /** Whether that connection is the bundled local sidecar. */
  isLocal: boolean;
  /** True when the backend has no workspaces and no ready providers. */
  setupNeeded: boolean;
}

export interface SetupPromptState {
  /** Latest completed evaluation, or null until the first one resolves. */
  evaluation: SetupEvaluation | null;
  /**
   * Remote connection ids whose setup prompt the user dismissed this
   * session. In-memory only — resets when the window reloads.
   */
  dismissedConnectionIds: string[];
  /**
   * Whether this page load's boot-route decision has been made (land on an
   * existing workspace vs. stay on onboarding). Made at most once per full
   * page load; in-memory only — resets when the window reloads.
   */
  bootRouteGateResolved: boolean;
}

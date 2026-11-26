/**
 * What the host does when an app connection closes without the host asking
 * (`docs/protocol/methods/apps.md` → "Reconnect" and "Session end").
 *
 * The daemon ends a session on revoke, uninstall, a replace install, a changed
 * feature grant, a daemon restart, and when the host's administrator
 * connection drops. The host cannot tell these apart from the closed socket,
 * so it reads the app again and opens a new session:
 *
 * - the same `bundleHash`, `level` and `features` → the window stays open;
 * - otherwise it emits `session-ended` with the reason and closes the window.
 *   A changed feature grant reopens the app with the new grant.
 *
 * No Electron imports.
 */
import {
  isIntentAppOpenable,
  type IntentApp,
  type IntentAppSession,
} from '../../../shared/intent-apps/intent-apps-types';

export type SessionEndReason = 'closed' | 'revoked' | 'uninstalled' | 'updated' | 'disconnected';

export type RecoveryDecision =
  /** Open a new session and keep the window when it matches. */
  | { kind: 'reopen' }
  /** End the window. `reopen`: open the app again afterwards in a new window. */
  | { kind: 'end'; reason: SessionEndReason; reopen: boolean };

function sameFeatures(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((feature) => set.has(feature));
}

/** Decide from the app record read after the loss (`null`: `app-not-found`). */
export function decideAfterSessionLoss(
  previous: Pick<IntentAppSession, 'bundleHash' | 'level' | 'features'>,
  app: IntentApp | null,
): RecoveryDecision {
  if (!app) return { kind: 'end', reason: 'uninstalled', reopen: false };
  if (app.approval.status === 'revoked') return { kind: 'end', reason: 'revoked', reopen: false };
  if (!isIntentAppOpenable(app)) return { kind: 'end', reason: 'updated', reopen: false };
  if (app.bundleHash !== previous.bundleHash) return { kind: 'end', reason: 'updated', reopen: false };
  if (app.approval.level !== previous.level || !sameFeatures(app.approval.features, previous.features)) {
    return { kind: 'end', reason: 'updated', reopen: true };
  }
  return { kind: 'reopen' };
}

/** Whether a new session may take over the open window. */
export function isSameGrant(
  previous: Pick<IntentAppSession, 'bundleHash' | 'level' | 'features'>,
  next: Pick<IntentAppSession, 'bundleHash' | 'level' | 'features'>,
): boolean {
  return (
    previous.bundleHash === next.bundleHash &&
    previous.level === next.level &&
    sameFeatures(previous.features, next.features)
  );
}
